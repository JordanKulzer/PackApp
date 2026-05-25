import { supabase } from "./supabase";

// Monotonic counter — gives each realtime channel a globally-unique name
// so concurrent hook instances / effect re-runs never share a channel
// with the memoized-by-name cache supabase-js maintains. Mirrors the
// proven pattern from usePackCategoryStandings (which calls this
// channelSeq too) — see its comment block for the bug it prevents.
let channelSeq = 0;

/**
 * Subscribe to realtime score changes for a single run.
 *
 * Channel naming: `scores-${consumerKey}-${runId}`. The consumerKey
 * namespace is REQUIRED when multiple consumers (e.g., Pack Detail and
 * Home) subscribe to the same runId. supabase-js memoizes channels by
 * name, returning the same RealtimeChannel instance on `.channel(name)`
 * calls with matching names — and you cannot add `postgres_changes`
 * callbacks to a channel that has already been `.subscribe()`d. Distinct
 * channel names per consumer sidestep that constraint. Pack Detail
 * passes "pack"; Home passes "home".
 *
 * Returns an unsubscribe function for caller-managed lifecycle.
 *
 * Pre-history: consolidates Pack Detail's inline subscription (added
 * pre-Pass-25), Home's inline subscription (Pass 25-followup-E.1-fix-3),
 * and the orphaned useLeaderboard hook (deleted in E.2.a.i). The
 * consumerKey parameter and corrected channel-name semantics landed in
 * Pass 25-followup-E.2.a.i-fix-realtime after E.2.a.i's claim that
 * supabase handles duplicate channel names cleanly was disproved at
 * runtime.
 */
export function subscribeToRunScores(
  runId: string,
  onChange: () => void,
  consumerKey: string,
): () => void {
  const channel = supabase
    .channel(`scores-${consumerKey}-${runId}-${++channelSeq}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "daily_scores",
        filter: `run_id=eq.${runId}`,
      },
      onChange,
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Subscribe to activity_feed INSERTs for achievement rows (daily_winner /
 * took_lead / all_goals) for a specific user.
 *
 * Pass 25-followup-E.2.b.iii: powers useUnpostedAchievements's live update
 * when detectAndRecordTookLead (or future HK auto-sync paths) writes a new
 * row while the user is on Home. Caller's `onInsert` callback typically
 * triggers a refetch of the unposted-achievements query — idempotent, the
 * new row already exists in the result so the refetch reflects it.
 *
 * Filter design: postgres_changes accepts a single `column=op.value` filter
 * server-side. We filter on `user_id=eq.${userId}` to scope to this user's
 * rows. The activity_type check happens client-side via a Set lookup —
 * sidesteps `in.` filter syntax edge cases observed in
 * E.2.a.i-fix-realtime debugging. INSERT-only because UPDATEs (e.g.,
 * VictoryPostSheet attaching a photo) shouldn't re-trigger the banner.
 *
 * consumerKey required (E.2.a.i-fix-realtime lesson — duplicate channel
 * names collide in supabase-js's channel memoization). Pass a unique
 * string per consumer, e.g., "unposted-achievements".
 */
export type AchievementFeedRow = {
  id: string;
  user_id: string;
  pack_id: string;
  activity_type: string;
  score_date: string;
  points_earned: number;
  created_at: string;
};

const ACHIEVEMENT_TYPES = new Set([
  "daily_winner",
  "took_lead",
  "all_goals",
]);

export function subscribeToAchievementInserts(
  userId: string,
  onInsert: (row: AchievementFeedRow) => void,
  consumerKey: string,
): () => void {
  const channel = supabase
    .channel(`achievements-${consumerKey}-${userId}-${++channelSeq}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "activity_feed",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const row = payload.new as AchievementFeedRow;
        if (ACHIEVEMENT_TYPES.has(row.activity_type)) {
          onInsert(row);
        }
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
