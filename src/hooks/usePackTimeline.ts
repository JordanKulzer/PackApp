// usePackTimeline — fetch + merge activity_feed and chat_messages into a
// single chronological TimelineItem[]. Mirrors the query/realtime patterns
// used by useActivityFeed.
//
// Phase C.1: read-only fetch + merge.
// Phase C.2: adds sendMessage / editMessage / softDeleteMessage with
// optimistic updates.
// Phase C.4: adds chat_message_reactions in the same fetch + realtime
// channel, plus toggleChatReaction. One-reaction-per-user model
// matching activity_reactions; same delete-then-insert dance to avoid
// fighting the UNIQUE (message_id, user_id) constraint without an
// UPDATE policy.

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import { FEATURE_FLAGS } from "../lib/featureFlags";
import { uploadChatPhoto } from "../lib/photoUpload";
import type { FeedItem, Reactor } from "./useActivityFeed";
import type { TimelineItem } from "../types/timeline";
import type { ActivityCategory } from "../lib/activityCategoryMap";

const MAX_BODY_LENGTH = 1000;

type ActivityReactionRow = {
  feed_item_id: string;
  user_id: string;
  reaction_type: string;
};

type ChatReactionRow = {
  message_id: string;
  user_id: string;
  reaction_type: string;
};

type ChatMessageRow = {
  id: string;
  pack_id: string;
  user_id: string;
  body: string;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  is_deleted: boolean;
  photo_url?: string | null;
};

// Generate a client-side temporary id for optimistic messages. Real DB ids
// never collide with this prefix.
function genTempId(): string {
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function usePackTimeline(
  packId: string | null,
  currentUserId: string | undefined,
) {
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Track our own author info so optimistic items can render the right
  // display_name/avatar without an extra round-trip.
  const selfRef = useRef<{
    id: string;
    display_name: string;
    avatar_url: string | null;
  } | null>(null);

  const fetchTimeline = useCallback(async () => {
    if (!packId) {
      setTimeline([]);
      setLoading(false);
      return;
    }

    let feedQuery = supabase
      .from("activity_feed")
      .select(
        "id, pack_id, user_id, activity_type, value, points_earned, created_at, entry_method, photo_url, photo_aspect, caption, score_date, comment_count, category",
      )
      .eq("pack_id", packId);
    if (!FEATURE_FLAGS.dailyWinner) {
      feedQuery = feedQuery.neq("activity_type", "daily_winner");
    }

    const [feedRes, messagesRes] = await Promise.all([
      feedQuery.order("created_at", { ascending: false }).limit(50),
      supabase
        .from("chat_messages")
        .select(
          "id, pack_id, user_id, body, created_at, updated_at, edited_at, is_deleted, photo_url",
        )
        .eq("pack_id", packId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    if (feedRes.error) {
      console.error("[usePackTimeline] feed fetch error:", feedRes.error);
      setError(feedRes.error.message);
      setLoading(false);
      return;
    }
    if (messagesRes.error) {
      console.error("[usePackTimeline] messages fetch error:", messagesRes.error);
      setError(messagesRes.error.message);
      setLoading(false);
      return;
    }

    const feedRows = feedRes.data ?? [];
    const messageRows = (messagesRes.data ?? []) as ChatMessageRow[];

    const feedIds = feedRows.map((r) => r.id);
    const messageIds = messageRows.map((r) => r.id);
    const userIds = [
      ...new Set([
        ...feedRows.map((r) => r.user_id),
        ...messageRows.map((r) => r.user_id),
      ]),
    ];

    const [activityReactionsRes, chatReactionsRes, usersRes] = await Promise.all([
      feedIds.length > 0
        ? supabase
            .from("activity_reactions")
            .select("feed_item_id, user_id, reaction_type")
            .in("feed_item_id", feedIds)
        : Promise.resolve({ data: [] as ActivityReactionRow[] }),
      messageIds.length > 0
        ? supabase
            .from("chat_message_reactions")
            .select("message_id, user_id, reaction_type")
            .in("message_id", messageIds)
        : Promise.resolve({ data: [] as ChatReactionRow[] }),
      userIds.length > 0
        ? supabase
            .from("users")
            .select("id, display_name, avatar_url")
            .in("id", userIds)
        : Promise.resolve({
            data: [] as {
              id: string;
              display_name: string;
              avatar_url: string | null;
            }[],
          }),
    ]);

    const nameMap: Record<string, string> = {};
    const avatarMap: Record<string, string | null> = {};
    (usersRes.data ?? []).forEach((u) => {
      nameMap[u.id] = u.display_name;
      avatarMap[u.id] = u.avatar_url ?? null;
    });

    // Cache self info for optimistic message rendering.
    if (currentUserId && nameMap[currentUserId]) {
      selfRef.current = {
        id: currentUserId,
        display_name: nameMap[currentUserId],
        avatar_url: avatarMap[currentUserId] ?? null,
      };
    }

    // Group raw reactor rows for activity items.
    const activityReactorsByItem: Record<string, Reactor[]> = {};
    (activityReactionsRes.data ?? []).forEach((r) => {
      if (!activityReactorsByItem[r.feed_item_id]) {
        activityReactorsByItem[r.feed_item_id] = [];
      }
      activityReactorsByItem[r.feed_item_id].push({
        user_id: r.user_id,
        reaction_type: r.reaction_type,
      });
    });

    // Group raw reactor rows for chat messages.
    const chatReactorsByMessage: Record<string, Reactor[]> = {};
    (chatReactionsRes.data ?? []).forEach((r) => {
      if (!chatReactorsByMessage[r.message_id]) {
        chatReactorsByMessage[r.message_id] = [];
      }
      chatReactorsByMessage[r.message_id].push({
        user_id: r.user_id,
        reaction_type: r.reaction_type,
      });
    });

    const activityItems: TimelineItem[] = feedRows.map(
      (row): TimelineItem => ({
        kind: "activity",
        sortKey: row.created_at,
        data: {
          id: row.id,
          packId: row.pack_id,
          userId: row.user_id,
          displayName: nameMap[row.user_id] ?? "Unknown",
          avatarUrl: avatarMap[row.user_id] ?? null,
          activityType: row.activity_type as FeedItem["activityType"],
          value: row.value ?? 0,
          pointsEarned: row.points_earned ?? 0,
          createdAt: row.created_at,
          entryMethod: (row.entry_method ?? "manual") as FeedItem["entryMethod"],
          photoUrl: row.photo_url ?? null,
          photoAspect:
            row.photo_aspect != null ? Number(row.photo_aspect) : null,
          caption: row.caption ?? null,
          scoreDate: row.score_date ?? null,
          commentCount: row.comment_count ?? 0,
          category: (row.category ?? null) as ActivityCategory | null,
          reactions: activityReactorsByItem[row.id] ?? [],
        },
      }),
    );

    // Soft-deleted messages remain in the result; the render layer renders
    // them as "[message deleted]" so threading/order isn't broken.
    const messageItems: TimelineItem[] = messageRows.map(
      (row): TimelineItem => ({
        kind: "message",
        sortKey: row.created_at,
        data: {
          id: row.id,
          pack_id: row.pack_id,
          user_id: row.user_id,
          body: row.body,
          created_at: row.created_at,
          updated_at: row.updated_at,
          edited_at: row.edited_at,
          is_deleted: row.is_deleted,
          photo_url: row.photo_url ?? null,
          author: {
            id: row.user_id,
            display_name: nameMap[row.user_id] ?? "Unknown",
            avatar_url: avatarMap[row.user_id] ?? null,
          },
          reactions: chatReactorsByMessage[row.id] ?? [],
        },
      }),
    );

    // Merge by created_at, oldest first (ASC) — newest renders at the
    // bottom of the visible list, matching standard chat conventions.
    // ISO-8601 timestamps sort lexicographically, so localeCompare works
    // as a numeric comparator.
    // After merge: drop any optimistic placeholders that the realtime echo
    // has already replaced with a real row matching (user_id, body) within
    // the last 10s. Keeps the UI consistent if the user spams send rapidly.
    setTimeline((prev) => {
      const optimistic = prev.filter(
        (it) => it.kind === "message" && it.data.id.startsWith("tmp-"),
      );
      const merged = [...activityItems, ...messageItems].sort((a, b) =>
        a.sortKey.localeCompare(b.sortKey),
      );
      const stillUnacked = optimistic.filter((opt) => {
        if (opt.kind !== "message") return false;
        return !merged.some((m) => {
          if (m.kind !== "message") return false;
          if (m.data.user_id !== opt.data.user_id) return false;
          if (m.data.body !== opt.data.body) return false;
          const dt = Math.abs(
            new Date(m.data.created_at).getTime() -
              new Date(opt.data.created_at).getTime(),
          );
          return dt < 10000;
        });
      });
      return [...stillUnacked, ...merged].sort((a, b) =>
        a.sortKey.localeCompare(b.sortKey),
      );
    });
    setError(null);
    setLoading(false);
  }, [packId, currentUserId]);

  useEffect(() => {
    if (!packId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchTimeline();

    // Refetch on any event rather than surgically patching the merge.
    // Includes chat_message_reactions so reaction pills update live for
    // both own and other users (own actions go through optimistic state
    // first; realtime echo settles the final state via refetch).
    const channel = supabase
      .channel(`timeline-${packId}`)
      .on(
        "postgres_changes",
        {
          // Phase 2 fix A: was "INSERT" — caught the share's initial row
          // but missed the post-upload `photo_url` UPDATE, so shared
          // photos didn't appear until the next manual refetch. Matches
          // the chat_messages subscription below (which already uses "*").
          event: "*",
          schema: "public",
          table: "activity_feed",
          filter: `pack_id=eq.${packId}`,
        },
        () => fetchTimeline(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_messages",
          filter: `pack_id=eq.${packId}`,
        },
        () => fetchTimeline(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_message_reactions",
        },
        () => fetchTimeline(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [packId, fetchTimeline]);

  // ── Write functions (Phase C.2) ──────────────────────────────────────────

  const sendMessage = useCallback(
    async (rawBody: string, photoLocalUri?: string | null): Promise<void> => {
      if (!packId) throw new Error("No active pack");
      if (!currentUserId) throw new Error("Not signed in");

      const body = rawBody.trim();
      // Pass C-revised: body MAY be empty when a photo is attached.
      // Without a photo, body is still required.
      if (body.length === 0 && !photoLocalUri) {
        throw new Error("Message cannot be empty");
      }
      if (body.length > MAX_BODY_LENGTH) {
        throw new Error(`Message too long (max ${MAX_BODY_LENGTH} characters)`);
      }

      const tempId = genTempId();
      const nowIso = new Date().toISOString();

      // Optimistic insert. Author info comes from selfRef populated by the
      // last fetch; if we somehow don't have it (cold start, no prior
      // messages), fall back to placeholders that the refetch will correct.
      const author = selfRef.current ?? {
        id: currentUserId,
        display_name: "You",
        avatar_url: null,
      };

      // Photo preview during upload: the optimistic row carries the local
      // URI as photo_url so the UI shows the picked image immediately. The
      // real row's photo_url (Storage path) replaces it on success.
      const optimistic: TimelineItem = {
        kind: "message",
        sortKey: nowIso,
        data: {
          id: tempId,
          pack_id: packId,
          user_id: currentUserId,
          body,
          created_at: nowIso,
          updated_at: nowIso,
          edited_at: null,
          is_deleted: false,
          photo_url: photoLocalUri ?? null,
          author,
          reactions: [],
        },
      };

      // ASC ordering → optimistic message lands at the end (bottom of list).
      setTimeline((prev) =>
        [...prev, optimistic].sort((a, b) => a.sortKey.localeCompare(b.sortKey)),
      );

      // INSERT first with body only — id is server-generated. A
      // client-supplied id was the prior shape; it tripped the
      // chat_messages INSERT (RLS / column constraints don't expect
      // a caller-set id). The Storage path is keyed off the real
      // returned id instead, so the photo upload runs AFTER the
      // insert succeeds.
      const { data, error: insErr } = await supabase
        .from("chat_messages")
        .insert({
          pack_id: packId,
          user_id: currentUserId,
          body,
        })
        .select(
          "id, pack_id, user_id, body, created_at, updated_at, edited_at, is_deleted, photo_url",
        )
        .single();

      if (insErr || !data) {
        // Revert optimistic insert.
        setTimeline((prev) =>
          prev.filter(
            (it) => !(it.kind === "message" && it.data.id === tempId),
          ),
        );
        throw insErr ?? new Error("Insert returned no data");
      }

      const real = data as ChatMessageRow;

      // Photo path: upload keyed off the real row id, then UPDATE the
      // row's photo_url. On upload/update failure, delete the just-
      // inserted row (it may have an empty body for photo-only sends)
      // and throw so the caller surfaces the error.
      let finalPhotoUrl: string | null = real.photo_url ?? null;
      if (photoLocalUri) {
        const photoPath = await uploadChatPhoto(
          currentUserId,
          real.id,
          photoLocalUri,
        );
        if (!photoPath) {
          await supabase.from("chat_messages").delete().eq("id", real.id);
          setTimeline((prev) =>
            prev.filter(
              (it) => !(it.kind === "message" && it.data.id === tempId),
            ),
          );
          throw new Error("Photo upload failed");
        }

        const { error: updErr } = await supabase
          .from("chat_messages")
          .update({ photo_url: photoPath })
          .eq("id", real.id);

        if (updErr) {
          await supabase.from("chat_messages").delete().eq("id", real.id);
          setTimeline((prev) =>
            prev.filter(
              (it) => !(it.kind === "message" && it.data.id === tempId),
            ),
          );
          throw updErr;
        }

        finalPhotoUrl = photoPath;
      }

      // Replace optimistic with the real row. Realtime INSERT may also fire
      // a refetch shortly after — the dedup logic in fetchTimeline drops
      // any leftover optimistic placeholders, so the brief overlap is safe.
      setTimeline((prev) =>
        prev
          .map((it) => {
            if (it.kind !== "message" || it.data.id !== tempId) return it;
            return {
              ...it,
              sortKey: real.created_at,
              data: {
                ...it.data,
                id: real.id,
                created_at: real.created_at,
                updated_at: real.updated_at,
                edited_at: real.edited_at,
                is_deleted: real.is_deleted,
                photo_url: finalPhotoUrl,
              },
            };
          })
          .sort((a, b) => a.sortKey.localeCompare(b.sortKey)),
      );
    },
    [packId, currentUserId],
  );

  const editMessage = useCallback(
    async (messageId: string, rawBody: string): Promise<void> => {
      const body = rawBody.trim();
      if (body.length === 0) throw new Error("Message cannot be empty");
      if (body.length > MAX_BODY_LENGTH) {
        throw new Error(`Message too long (max ${MAX_BODY_LENGTH} characters)`);
      }

      // Capture previous body/edited_at for rollback.
      let prevBody: string | null = null;
      let prevEditedAt: string | null = null;
      const nowIso = new Date().toISOString();

      setTimeline((prev) =>
        prev.map((it) => {
          if (it.kind !== "message" || it.data.id !== messageId) return it;
          prevBody = it.data.body;
          prevEditedAt = it.data.edited_at;
          return {
            ...it,
            data: { ...it.data, body, edited_at: nowIso },
          };
        }),
      );

      const { error: updErr } = await supabase
        .from("chat_messages")
        .update({ body })
        .eq("id", messageId);

      if (updErr) {
        // Revert.
        setTimeline((prev) =>
          prev.map((it) => {
            if (it.kind !== "message" || it.data.id !== messageId) return it;
            return {
              ...it,
              data: {
                ...it.data,
                body: prevBody ?? it.data.body,
                edited_at: prevEditedAt,
              },
            };
          }),
        );
        throw updErr;
      }
    },
    [],
  );

  const softDeleteMessage = useCallback(
    async (messageId: string): Promise<void> => {
      let prevDeleted: boolean | null = null;

      setTimeline((prev) =>
        prev.map((it) => {
          if (it.kind !== "message" || it.data.id !== messageId) return it;
          prevDeleted = it.data.is_deleted;
          return {
            ...it,
            data: { ...it.data, is_deleted: true },
          };
        }),
      );

      const { error: delErr } = await supabase
        .from("chat_messages")
        .update({ is_deleted: true })
        .eq("id", messageId);

      if (delErr) {
        setTimeline((prev) =>
          prev.map((it) => {
            if (it.kind !== "message" || it.data.id !== messageId) return it;
            return {
              ...it,
              data: { ...it.data, is_deleted: prevDeleted ?? false },
            };
          }),
        );
        throw delErr;
      }
    },
    [],
  );

  // Toggle a reaction on a chat message. Mirrors useActivityFeed's
  // toggleReaction exactly: one-reaction-per-user, delete-then-insert
  // when switching, full optimistic update with revert on error.
  const toggleChatReaction = useCallback(
    async (messageId: string, emoji: string): Promise<void> => {
      if (!currentUserId) return;

      // Determine prev reaction synchronously from state.
      let prevType: string | null = null;

      setTimeline((prev) => {
        const item = prev.find(
          (it) => it.kind === "message" && it.data.id === messageId,
        );
        if (!item || item.kind !== "message") return prev;
        const mine = item.data.reactions.find(
          (rx) => rx.user_id === currentUserId,
        );
        prevType = mine?.reaction_type ?? null;
        const isSame = prevType === emoji;

        return prev.map((it) => {
          if (it.kind !== "message" || it.data.id !== messageId) return it;
          const without = it.data.reactions.filter(
            (rx) => rx.user_id !== currentUserId,
          );
          const next = isSame
            ? without
            : [...without, { user_id: currentUserId, reaction_type: emoji }];
          return { ...it, data: { ...it.data, reactions: next } };
        });
      });

      const isSame = prevType === emoji;
      const hadDifferent = prevType !== null && !isSame;

      const revert = () => {
        setTimeline((prev) =>
          prev.map((it) => {
            if (it.kind !== "message" || it.data.id !== messageId) return it;
            const without = it.data.reactions.filter(
              (rx) => rx.user_id !== currentUserId,
            );
            return {
              ...it,
              data: {
                ...it.data,
                reactions: prevType
                  ? [...without, { user_id: currentUserId, reaction_type: prevType }]
                  : without,
              },
            };
          }),
        );
      };

      if (isSame) {
        // Toggle off: delete existing.
        const { error: delErr } = await supabase
          .from("chat_message_reactions")
          .delete()
          .eq("message_id", messageId)
          .eq("user_id", currentUserId);
        if (delErr) {
          console.error("[toggleChatReaction] delete error:", delErr);
          revert();
        }
      } else if (hadDifferent) {
        // Switch: delete old then insert new.
        const { error: delErr } = await supabase
          .from("chat_message_reactions")
          .delete()
          .eq("message_id", messageId)
          .eq("user_id", currentUserId);
        if (delErr) {
          console.error("[toggleChatReaction] switch delete error:", delErr);
          revert();
          return;
        }
        const { error: insErr } = await supabase
          .from("chat_message_reactions")
          .insert({
            message_id: messageId,
            user_id: currentUserId,
            reaction_type: emoji,
          });
        if (insErr) {
          console.error("[toggleChatReaction] switch insert error:", insErr);
          revert();
        }
      } else {
        // No prior reaction in client state. Defensive delete first
        // (avoids 23505 if DB has a stale row the client missed).
        await supabase
          .from("chat_message_reactions")
          .delete()
          .eq("message_id", messageId)
          .eq("user_id", currentUserId);
        const { error: insErr } = await supabase
          .from("chat_message_reactions")
          .insert({
            message_id: messageId,
            user_id: currentUserId,
            reaction_type: emoji,
          });
        if (insErr) {
          console.error("[toggleChatReaction] insert error:", insErr);
          revert();
        }
      }
    },
    [currentUserId],
  );

  return {
    timeline,
    loading,
    error,
    refetch: fetchTimeline,
    sendMessage,
    editMessage,
    softDeleteMessage,
    toggleChatReaction,
  };
}
