import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";

export type ReactionType = "💪" | "🔥" | "👏";
const REACTION_TYPES: ReactionType[] = ["💪", "🔥", "👏"];

export interface FeedItem {
  id: string;
  packId: string;
  userId: string;
  displayName: string;
  activityType: "steps" | "workout" | "calories" | "water" | "took_lead" | "all_goals";
  value: number;
  pointsEarned: number;
  createdAt: string;
  entryMethod: "manual" | "healthkit" | "oura" | "whoop";
  photoUrl: string | null;   // Supabase Storage path (not a full URL)
  reactions: {
    type: ReactionType;
    count: number;
    hasReacted: boolean;
  }[];
}

type ReactionRow = {
  feed_item_id: string;
  user_id: string;
  reaction_type: ReactionType;
};

export function useActivityFeed(packId: string, currentUserId: string | undefined) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchFeed = useCallback(async () => {
    if (!packId) return;

    const { data: feedRows, error } = await supabase
      .from("activity_feed")
      .select("id, pack_id, user_id, activity_type, value, points_earned, created_at, entry_method, photo_url")
      .eq("pack_id", packId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[useActivityFeed] fetch error:", error);
      setIsLoading(false);
      return;
    }
    if (!feedRows) {
      setIsLoading(false);
      return;
    }

    const feedIds = feedRows.map((r) => r.id);
    const userIds = [...new Set(feedRows.map((r) => r.user_id))];

    const [reactionsResult, usersResult] = await Promise.all([
      feedIds.length > 0
        ? supabase
            .from("activity_reactions")
            .select("feed_item_id, user_id, reaction_type")
            .in("feed_item_id", feedIds)
        : Promise.resolve({ data: [] as ReactionRow[] }),
      userIds.length > 0
        ? supabase
            .from("users")
            .select("id, display_name")
            .in("id", userIds)
        : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
    ]);

    const nameMap: Record<string, string> = {};
    (usersResult.data ?? []).forEach((u) => {
      nameMap[u.id] = u.display_name;
    });

    // Group reactions by feed_item_id → reaction_type → { count, hasReacted }
    // DB constraint guarantees at most one row per (feed_item_id, user_id).
    const reactionsByItem: Record<string, Record<ReactionType, { count: number; hasReacted: boolean }>> = {};
    (reactionsResult.data ?? []).forEach((r) => {
      if (!reactionsByItem[r.feed_item_id]) {
        reactionsByItem[r.feed_item_id] = {
          "💪": { count: 0, hasReacted: false },
          "🔥": { count: 0, hasReacted: false },
          "👏": { count: 0, hasReacted: false },
        };
      }
      const type = r.reaction_type as ReactionType;
      reactionsByItem[r.feed_item_id][type].count += 1;
      if (r.user_id === currentUserId) {
        reactionsByItem[r.feed_item_id][type].hasReacted = true;
      }
    });

    const mapped: FeedItem[] = feedRows.map((row) => ({
      id: row.id,
      packId: row.pack_id,
      userId: row.user_id,
      displayName: nameMap[row.user_id] ?? "Unknown",
      activityType: row.activity_type as FeedItem["activityType"],
      value: row.value ?? 0,
      pointsEarned: row.points_earned ?? 0,
      createdAt: row.created_at,
      entryMethod: (row.entry_method ?? "manual") as FeedItem["entryMethod"],
      photoUrl: row.photo_url ?? null,
      reactions: REACTION_TYPES.map((type) => ({
        type,
        count: reactionsByItem[row.id]?.[type]?.count ?? 0,
        hasReacted: reactionsByItem[row.id]?.[type]?.hasReacted ?? false,
      })),
    }));

    setItems(mapped);
    setIsLoading(false);
  }, [packId, currentUserId]);

  useEffect(() => {
    if (!packId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    fetchFeed();

    const channel = supabase
      .channel(`feed-${packId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "activity_feed", filter: `pack_id=eq.${packId}` },
        () => fetchFeed()
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "activity_reactions" },
        (payload) => {
          const r = payload.new as ReactionRow;
          // Skip own reactions — already applied optimistically in toggleReaction.
          if (r.user_id === currentUserId) return;
          setItems((prev) =>
            prev.map((item) => {
              if (item.id !== r.feed_item_id) return item;
              return {
                ...item,
                reactions: item.reactions.map((rx) =>
                  rx.type === r.reaction_type
                    ? { ...rx, count: rx.count + 1 }
                    : rx
                ),
              };
            })
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "activity_reactions" },
        (payload) => {
          const r = payload.old as ReactionRow;
          // Skip own reactions — already applied optimistically in toggleReaction.
          if (r.user_id === currentUserId) return;
          setItems((prev) =>
            prev.map((item) => {
              if (item.id !== r.feed_item_id) return item;
              return {
                ...item,
                reactions: item.reactions.map((rx) =>
                  rx.type === r.reaction_type
                    ? { ...rx, count: Math.max(0, rx.count - 1) }
                    : rx
                ),
              };
            })
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [packId, fetchFeed]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleReaction = useCallback(
    async (feedItemId: string, reactionType: ReactionType) => {
      if (!currentUserId) return;

      // Read the current user's existing reaction synchronously from state.
      // The setState callback runs synchronously, so prevType is set before
      // the await below.
      let prevType: ReactionType | null = null;

      setItems((prev) => {
        const item = prev.find((i) => i.id === feedItemId);
        prevType = item?.reactions.find((rx) => rx.hasReacted)?.type ?? null;
        const isSame = prevType === reactionType;

        return prev.map((i) => {
          if (i.id !== feedItemId) return i;
          return {
            ...i,
            reactions: i.reactions.map((rx) => {
              // Deactivate the old reaction when switching
              if (rx.type === prevType && prevType !== null && !isSame) {
                return { ...rx, count: Math.max(0, rx.count - 1), hasReacted: false };
              }
              if (rx.type === reactionType) {
                return isSame
                  ? { ...rx, count: Math.max(0, rx.count - 1), hasReacted: false }
                  : { ...rx, count: rx.count + 1, hasReacted: true };
              }
              return rx;
            }),
          };
        });
      });

      const isSame = prevType === reactionType;
      const hadDifferent = prevType !== null && !isSame;

      if (isSame) {
        // Toggle off: remove existing reaction
        const { error } = await supabase
          .from("activity_reactions")
          .delete()
          .eq("feed_item_id", feedItemId)
          .eq("user_id", currentUserId);

        if (error) {
          console.error("[toggleReaction] delete error:", error);
          setItems((prev) =>
            prev.map((i) =>
              i.id !== feedItemId
                ? i
                : {
                    ...i,
                    reactions: i.reactions.map((rx) =>
                      rx.type === reactionType
                        ? { ...rx, count: rx.count + 1, hasReacted: true }
                        : rx
                    ),
                  }
            )
          );
        }
      } else if (hadDifferent) {
        // Switch: delete old reaction, insert new one
        const oldType = prevType!;

        const { error: delErr } = await supabase
          .from("activity_reactions")
          .delete()
          .eq("feed_item_id", feedItemId)
          .eq("user_id", currentUserId);

        if (delErr) {
          console.error("[toggleReaction] switch delete error:", delErr);
          // Revert both changes
          setItems((prev) =>
            prev.map((i) =>
              i.id !== feedItemId
                ? i
                : {
                    ...i,
                    reactions: i.reactions.map((rx) => {
                      if (rx.type === oldType) return { ...rx, count: rx.count + 1, hasReacted: true };
                      if (rx.type === reactionType) return { ...rx, count: Math.max(0, rx.count - 1), hasReacted: false };
                      return rx;
                    }),
                  }
            )
          );
          return;
        }

        // The delete above already cleared the row, so a plain insert is safe.
        const { error: insErr } = await supabase
          .from("activity_reactions")
          .insert({ feed_item_id: feedItemId, user_id: currentUserId, reaction_type: reactionType });

        if (insErr) {
          console.error("[toggleReaction] switch insert error:", insErr);
          // Delete succeeded but insert failed — revert the new reaction only
          setItems((prev) =>
            prev.map((i) =>
              i.id !== feedItemId
                ? i
                : {
                    ...i,
                    reactions: i.reactions.map((rx) =>
                      rx.type === reactionType
                        ? { ...rx, count: Math.max(0, rx.count - 1), hasReacted: false }
                        : rx
                    ),
                  }
            )
          );
        }
      } else {
        // No prior reaction in client state. Delete first in case the DB has a
        // stale row the client missed (avoids 23505 without needing UPDATE policy).
        await supabase
          .from("activity_reactions")
          .delete()
          .eq("feed_item_id", feedItemId)
          .eq("user_id", currentUserId);

        const { error } = await supabase
          .from("activity_reactions")
          .insert({ feed_item_id: feedItemId, user_id: currentUserId, reaction_type: reactionType });

        if (error) {
          console.error("[toggleReaction] insert error:", error);
          setItems((prev) =>
            prev.map((i) =>
              i.id !== feedItemId
                ? i
                : {
                    ...i,
                    reactions: i.reactions.map((rx) =>
                      rx.type === reactionType
                        ? { ...rx, count: Math.max(0, rx.count - 1), hasReacted: false }
                        : rx
                    ),
                  }
            )
          );
        }
      }
    },
    [currentUserId]
  );

  const removePhotoFromItem = useCallback(
    async (feedItemId: string) => {
      // Optimistic UI update
      setItems((prev) =>
        prev.map((i) => (i.id === feedItemId ? { ...i, photoUrl: null } : i)),
      );
      await supabase
        .from("activity_feed")
        .update({ photo_url: null })
        .eq("id", feedItemId);
    },
    [],
  );

  return { items, isLoading, toggleReaction, removePhotoFromItem };
}
