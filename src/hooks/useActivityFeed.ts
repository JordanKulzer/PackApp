import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { analytics } from "../lib/analytics";
import { FEATURE_FLAGS } from "../lib/featureFlags";
import type { ActivityCategory } from "../lib/activityCategoryMap";

// Monotonic counter — gives each realtime channel a globally-unique name
// so concurrent hook instances / effect re-runs never share a channel
// with the memoized-by-name cache supabase-js maintains. Mirrors the
// proven pattern from usePackCategoryStandings.
let channelSeq = 0;

// Reaction emoji is now an open string — the picker decides which set to
// offer. Existing legacy values ('💪' '🔥' '👏') still render in pills if
// present in old rows; new reactions come from the 6-emoji picker set.
export type ReactionType = string;

export interface Reactor {
  user_id: string;
  reaction_type: ReactionType;
}

export interface FeedItem {
  id: string;
  packId: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  activityType:
    | "steps"
    | "workout"
    | "calories"
    | "water"
    | "took_lead"
    | "all_goals"
    | "goals_updated"
    | "pack_renamed"
    | "daily_winner"
    // Intentional-sharing Phase 2: manual-share variants. The DB CHECK
    // constraint already accepts these (migration 20260510); rows are
    // emitted by SharePostSheet via createSharePost.
    | "steps_share"
    | "workout_share"
    | "calories_share"
    | "water_share";
  value: number;
  pointsEarned: number;
  createdAt: string;
  entryMethod: "manual" | "healthkit" | "oura" | "whoop" | "system";
  photoUrl: string | null; // Supabase Storage path (not a full URL)
  // Source aspect ratio (width / height) of the photo, captured at share
  // create time. NULL for: photo-less rows, and pre-photo_aspect-column
  // legacy rows (FeedItemRow falls back to Image.getSize for those).
  photoAspect: number | null;
  caption: string | null;
  scoreDate: string | null;
  commentCount: number;
  // Workout sub-type category. Populated only for activityType==="workout"
  // rows; NULL for steps/calories/water/took_lead/all_goals/daily_winner.
  category: ActivityCategory | null;
  // Flat array of reactors. ReactionPills aggregates by emoji at render
  // time. UNIQUE (feed_item_id, user_id) on the DB enforces one reaction
  // per user, so each user appears at most once per item.
  reactions: Reactor[];
}

type ReactionRow = {
  feed_item_id: string;
  user_id: string;
  reaction_type: string;
};

// Pass 9 funnel — fires reaction_given after a successful insert (toggle-on
// or switch). Toggle-OFF (delete-only) does NOT fire — it's not a "reaction
// given" event. The two insert paths in toggleReaction call this on success.
//
// is_first_reaction_ever is racy with the post-insert COUNT (the just-written
// row is in the count) — count === 1 means it's the only one. For the switch
// path, the user had a prior reaction by definition, so we pass false directly
// without a query.
async function fireReactionGiven(
  userId: string,
  feedItemId: string,
  reactionType: string,
  items: FeedItem[],
  knownNotFirst = false,
): Promise<void> {
  const item = items.find((i) => i.id === feedItemId);
  if (!item) return;
  let isFirst = false;
  if (!knownNotFirst) {
    const { count } = await supabase
      .from("activity_reactions")
      .select("feed_item_id", { count: "exact", head: true })
      .eq("user_id", userId);
    isFirst = (count ?? 0) <= 1;
  }
  analytics.reactionGiven({
    is_first_reaction_ever: isFirst,
    reaction_type: reactionType,
    target_activity_type: item.activityType,
    target_user_is_self: item.userId === userId,
  });
}

export function useActivityFeed(packId: string, currentUserId: string | undefined) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchFeed = useCallback(async () => {
    if (!packId) return;

    let query = supabase
      .from("activity_feed")
      .select("id, pack_id, user_id, activity_type, value, points_earned, created_at, entry_method, photo_url, photo_aspect, caption, score_date, comment_count, category")
      .eq("pack_id", packId);
    if (!FEATURE_FLAGS.dailyWinner) {
      query = query.neq("activity_type", "daily_winner");
    }
    const { data: feedRows, error } = await query
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
            .select("id, display_name, avatar_url")
            .in("id", userIds)
        : Promise.resolve({ data: [] as { id: string; display_name: string; avatar_url: string | null }[] }),
    ]);

    const nameMap: Record<string, string> = {};
    const avatarMap: Record<string, string | null> = {};
    (usersResult.data ?? []).forEach((u) => {
      nameMap[u.id] = u.display_name;
      avatarMap[u.id] = u.avatar_url ?? null;
    });

    // Group raw reactors by feed_item_id. DB constraint UNIQUE
    // (feed_item_id, user_id) → at most one row per (item, user).
    const reactorsByItem: Record<string, Reactor[]> = {};
    (reactionsResult.data ?? []).forEach((r) => {
      if (!reactorsByItem[r.feed_item_id]) reactorsByItem[r.feed_item_id] = [];
      reactorsByItem[r.feed_item_id].push({
        user_id: r.user_id,
        reaction_type: r.reaction_type,
      });
    });

    const mapped: FeedItem[] = feedRows.map((row) => ({
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
      // postgrest serializes `numeric` columns as strings to preserve
      // arbitrary precision; Number() coerces to a JS float (precision
      // loss is irrelevant for a 2-digit aspect ratio).
      photoAspect:
        row.photo_aspect != null ? Number(row.photo_aspect) : null,
      caption: row.caption ?? null,
      scoreDate: row.score_date ?? null,
      commentCount: row.comment_count ?? 0,
      category: (row.category ?? null) as ActivityCategory | null,
      reactions: reactorsByItem[row.id] ?? [],
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
      .channel(`feed-${packId}-${++channelSeq}`)
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
              // Replace any existing entry for this user (one-per-user
              // constraint) and append the new reaction.
              const without = item.reactions.filter((rx) => rx.user_id !== r.user_id);
              return {
                ...item,
                reactions: [...without, { user_id: r.user_id, reaction_type: r.reaction_type }],
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
                reactions: item.reactions.filter(
                  (rx) => !(rx.user_id === r.user_id && rx.reaction_type === r.reaction_type),
                ),
              };
            })
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "feed_comments" },
        (payload) => {
          const r = payload.new as { feed_item_id: string; user_id: string };
          // Skip own comments — already applied optimistically via onCommentAdded.
          if (r.user_id === currentUserId) return;
          setItems((prev) =>
            prev.map((item) =>
              item.id === r.feed_item_id
                ? { ...item, commentCount: item.commentCount + 1 }
                : item
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [packId, fetchFeed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Toggle a reaction on an activity item. One-reaction-per-user model:
  // - Tapping the same emoji you already reacted with → removes it.
  // - Tapping a different emoji → replaces your existing reaction.
  // - No prior reaction → adds it.
  // Mirrors the original useActivityFeed pattern: delete-then-insert at
  // the DB layer (avoids hitting the UNIQUE (item, user) constraint with
  // a plain UPDATE), full optimistic update, revert on error.
  const toggleReaction = useCallback(
    async (feedItemId: string, reactionType: ReactionType) => {
      if (!currentUserId) return;

      // Determine prev reaction synchronously from state.
      let prevType: string | null = null;

      setItems((prev) => {
        const item = prev.find((i) => i.id === feedItemId);
        const mine = item?.reactions.find((rx) => rx.user_id === currentUserId);
        prevType = mine?.reaction_type ?? null;
        const isSame = prevType === reactionType;

        return prev.map((i) => {
          if (i.id !== feedItemId) return i;
          // Drop any existing entry for this user.
          const without = i.reactions.filter((rx) => rx.user_id !== currentUserId);
          // Re-add only if not toggling off.
          const next = isSame
            ? without
            : [...without, { user_id: currentUserId, reaction_type: reactionType }];
          return { ...i, reactions: next };
        });
      });

      const isSame = prevType === reactionType;
      const hadDifferent = prevType !== null && !isSame;

      const revert = () => {
        setItems((prev) =>
          prev.map((i) => {
            if (i.id !== feedItemId) return i;
            const without = i.reactions.filter((rx) => rx.user_id !== currentUserId);
            // Restore prevType (or remove if there was none).
            return {
              ...i,
              reactions: prevType
                ? [...without, { user_id: currentUserId, reaction_type: prevType }]
                : without,
            };
          }),
        );
      };

      if (isSame) {
        const { error } = await supabase
          .from("activity_reactions")
          .delete()
          .eq("feed_item_id", feedItemId)
          .eq("user_id", currentUserId);
        if (error) {
          console.error("[toggleReaction] delete error:", error);
          revert();
        }
      } else if (hadDifferent) {
        // Switch: delete old reaction, insert new one. Plain UPDATE
        // doesn't work because the old row's UNIQUE (item, user) would
        // fight an INSERT and there's no UPDATE policy for switching.
        const { error: delErr } = await supabase
          .from("activity_reactions")
          .delete()
          .eq("feed_item_id", feedItemId)
          .eq("user_id", currentUserId);
        if (delErr) {
          console.error("[toggleReaction] switch delete error:", delErr);
          revert();
          return;
        }
        const { error: insErr } = await supabase
          .from("activity_reactions")
          .insert({ feed_item_id: feedItemId, user_id: currentUserId, reaction_type: reactionType });
        if (insErr) {
          console.error("[toggleReaction] switch insert error:", insErr);
          revert();
        } else {
          // Switch path: user had a prior reaction by definition, so
          // is_first_reaction_ever is always false here.
          fireReactionGiven(currentUserId, feedItemId, reactionType, items, true);
        }
      } else {
        // No prior reaction in client state. Defensive delete in case
        // the DB has a stale row the client missed (avoids 23505).
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
          revert();
        } else {
          fireReactionGiven(currentUserId, feedItemId, reactionType, items);
        }
      }
    },
    [currentUserId, items]
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
