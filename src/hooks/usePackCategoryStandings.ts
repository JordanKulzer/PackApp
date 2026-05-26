// usePackCategoryStandings — the data layer for the categories-pivot
// leaderboard. Reads two surfaces and merges them:
//
//   • daily_winners  — settled per-day-per-category winners for the run.
//                      Aggregated into per-user wins counts.
//   • daily_scores   — today's live per-category metric values, used to
//                      surface the provisional "today's leader" before
//                      the day closes and a daily_winners row exists.
//
// Always returns all 4 categories in todayByCategory (Pattern A) and a
// member set padded with zeros, so the UI never has to special-case
// missing data. Ties are first-class — winner_user_ids is a uuid[] and
// todayLeaderIds is a string[].

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import {
  CATEGORIES,
  type Category,
  CATEGORY_DAILY_SCORE_COLUMN,
} from "../lib/categories";
import { packToday } from "../lib/packDates";
import { useScoreStore } from "../stores/scoreStore";

export type CategoryStanding = {
  category: Category;
  // Today's leader(s) — tied leaders supported, empty when no one logged.
  todayLeaderIds: string[];
  // The metric value of the leader (0 when there is no leader).
  todayLeaderValue: number;
  // Per-user today values. Padded with 0 for members who haven't logged.
  todayValuesByUser: Record<string, number>;
};

export type MemberWinsCount = {
  userId: string;
  totalWins: number;
  winsByCategory: Record<Category, number>;
};

export type PackCategoryStandings = {
  todayByCategory: Record<Category, CategoryStanding>;
  memberWins: MemberWinsCount[];
  rankedMembers: MemberWinsCount[]; // sorted by totalWins desc
};

// ── Query row shapes ─────────────────────────────────────────────────────
// Exported so external callers (e.g. Home's fetchPackMembers, which
// pre-fetches standings to seed `usePackCategoryStandings` via its new
// `initialData` param) can type their query results identically.
export type DailyWinnerRow = {
  category: Category;
  winner_user_ids: string[];
};

export type ScoreRow = {
  user_id: string;
  steps_count: number;
  workout_count: number;
  calories_count: number;
  water_oz_count: number;
};

// Fresh per-category wins record, all categories zeroed.
function emptyWinsByCategory(): Record<Category, number> {
  return { steps: 0, workouts: 0, calories: 0, water: 0 };
}

// Pure derivation: turns raw daily_winners + daily_scores rows + the
// passed-in member set into the PackCategoryStandings shape consumers
// render from. Extracted from Effect 1's body so an external caller
// (Home's fetchPackMembers, hoisting the initial fetch out of the per-
// card hook) can produce the same shape and seed the hook via
// `initialData` — no behavior change relative to the prior inline
// derivation.
export function buildPackCategoryStandings(
  winnerRows: DailyWinnerRow[],
  scoreRows: ScoreRow[],
  members: string[],
): PackCategoryStandings {
  // ── memberWins: tally per-user per-category wins from daily_winners.
  // winner_user_ids is a uuid[] — a tied day credits every listed
  // user. Seed every passed-in member at zero so the returned set is
  // the full roster regardless of who has actually won a day.
  const winsByUser: Record<string, MemberWinsCount> = {};
  for (const id of members) {
    winsByUser[id] = {
      userId: id,
      totalWins: 0,
      winsByCategory: emptyWinsByCategory(),
    };
  }
  for (const row of winnerRows) {
    for (const uid of row.winner_user_ids) {
      // A winner outside the passed-in member set (e.g. a member who
      // has since left the pack) is still counted — create on demand.
      if (!winsByUser[uid]) {
        winsByUser[uid] = {
          userId: uid,
          totalWins: 0,
          winsByCategory: emptyWinsByCategory(),
        };
      }
      winsByUser[uid].winsByCategory[row.category] += 1;
      winsByUser[uid].totalWins += 1;
    }
  }
  const memberWins = Object.values(winsByUser);

  // ── todayByCategory: per-category leader from today's daily_scores.
  // Every category always appears (Pattern A). Per-user values padded
  // with 0 for members with no daily_scores row today.
  const todayByCategory = {} as Record<Category, CategoryStanding>;
  for (const category of CATEGORIES) {
    const column = CATEGORY_DAILY_SCORE_COLUMN[category];
    const todayValuesByUser: Record<string, number> = {};
    for (const id of members) todayValuesByUser[id] = 0;
    for (const row of scoreRows) {
      todayValuesByUser[row.user_id] = row[column] ?? 0;
    }
    const values = Object.values(todayValuesByUser);
    const todayLeaderValue = values.length > 0 ? Math.max(...values) : 0;
    // A leader only exists once someone has a non-zero value — an
    // all-zero category has no leader (empty array).
    const todayLeaderIds =
      todayLeaderValue > 0
        ? Object.keys(todayValuesByUser).filter(
            (id) => todayValuesByUser[id] === todayLeaderValue,
          )
        : [];
    todayByCategory[category] = {
      category,
      todayLeaderIds,
      todayLeaderValue,
      todayValuesByUser,
    };
  }

  // ── rankedMembers: memberWins sorted by total wins desc.
  const rankedMembers = [...memberWins].sort(
    (a, b) => b.totalWins - a.totalWins,
  );

  return { todayByCategory, memberWins, rankedMembers };
}

// Monotonic counter — gives each realtime channel a globally-unique name
// so concurrent hook instances / effect re-runs never share a channel.
let channelSeq = 0;

export function usePackCategoryStandings(
  packId: string,
  runId: string | null,
  packTimezone: string,
  memberIds: string[],
  // Optional seed — when provided (Home pre-fetches via fetchPackMembers
  // and hands the already-derived standings down through the card), the
  // hook starts with this data and SKIPS its first network round-trip so
  // the card paints correct rings on the first frame. Effect 2's
  // realtime subscription is untouched; subsequent invalidations re-fetch
  // normally and override the seed. Backward-compatible: callers that
  // pass nothing (e.g. the Compete tab in pack/[id].tsx) behave exactly
  // as before — null start, cold fetch on mount.
  initialData?: PackCategoryStandings | null,
): {
  data: PackCategoryStandings | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const [data, setData] = useState<PackCategoryStandings | null>(
    initialData ?? null,
  );
  const [isLoading, setIsLoading] = useState(!initialData);
  const [error, setError] = useState<Error | null>(null);
  const [refetchKey, setRefetchKey] = useState(0);

  // Seed-skip latch: true on mount when initialData is provided; flipped
  // false after the first Effect 1 invocation. Subsequent dep changes
  // (refetchKey++ from realtime, logVersion bump from local logs) run
  // Effect 1 normally — only the very first run is skipped.
  const skipInitialFetchRef = useRef(initialData != null);

  const refetch = useCallback(() => {
    setRefetchKey((k) => k + 1);
  }, []);

  // Same-device "just logged" signal. bumpLogVersion() fires after every
  // local activity log (steps/water/etc.); folding logVersion into the
  // fetch effect's deps gives this hook a deterministic refresh that does
  // NOT depend on realtime delivery — mirrors pack/[id].tsx's existing
  // logVersion → fetchWeekly pattern.
  const logVersion = useScoreStore((s) => s.logVersion);

  // memberIds is a fresh array each render — key off its joined form so the
  // effect only re-runs when the actual member set changes.
  const memberKey = memberIds.join(",");

  useEffect(() => {
    if (!runId) {
      setData(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    // Seed-skip: on the very first run when initialData was provided,
    // return early — `data` is already correct from useState. Flip the
    // ref so subsequent dep changes (refetchKey++ from realtime,
    // logVersion bump) run normally.
    if (skipInitialFetchRef.current) {
      skipInitialFetchRef.current = false;
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const members = memberKey === "" ? [] : memberKey.split(",");

    (async () => {
      try {
        const today = packToday(packTimezone);

        const [winnersRes, scoresRes] = await Promise.all([
          supabase
            .from("daily_winners")
            .select("category, winner_user_ids")
            .eq("run_id", runId)
            .neq("category", "legacy"),
          supabase
            .from("daily_scores")
            .select(
              "user_id, steps_count, workout_count, calories_count, water_oz_count",
            )
            .eq("run_id", runId)
            .eq("score_date", today),
        ]);

        if (winnersRes.error) throw winnersRes.error;
        if (scoresRes.error) throw scoresRes.error;
        if (cancelled) return;

        const winnerRows = (winnersRes.data ?? []) as DailyWinnerRow[];
        const scoreRows = (scoresRes.data ?? []) as ScoreRow[];

        setData(buildPackCategoryStandings(winnerRows, scoreRows, members));
        setIsLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [packId, runId, packTimezone, memberKey, refetchKey, logVersion]);

  // ── Realtime: refetch on any daily_winners / daily_scores change for
  // this run. Its own effect, keyed on [packId, runId] only (NOT
  // refetchKey) — the channel is created once per run, not torn down and
  // rebuilt on every refetch. The callbacks bump refetchKey, which re-runs
  // the data-fetch effect above.
  useEffect(() => {
    if (!runId) return;

    // One postgres_changes binding per channel — the app's proven pattern
    // (see subscribeToRunScores). Multiple bindings on a single channel is
    // a fragile supabase-js path, so daily_winners and daily_scores each
    // get their own channel. The two daily_scores INSERT/UPDATE bindings
    // collapse into a single event:"*" binding.
    //
    // Unique names per subscription — two concurrent hook instances for the
    // same pack (e.g. Home's pack card + the Pack Detail screen, both
    // mounted) must not collide on one channel name.
    const winnersChannel = supabase
      .channel(`pack-cat-standings-winners-${packId}-${runId}-${++channelSeq}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "daily_winners",
          filter: `run_id=eq.${runId}`,
        },
        () => setRefetchKey((k) => k + 1),
      )
      .subscribe();

    const scoresChannel = supabase
      .channel(`pack-cat-standings-scores-${packId}-${runId}-${++channelSeq}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "daily_scores",
          filter: `run_id=eq.${runId}`,
        },
        () => setRefetchKey((k) => k + 1),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(winnersChannel);
      supabase.removeChannel(scoresChannel);
    };
  }, [packId, runId]);

  return { data, isLoading, error, refetch };
}
