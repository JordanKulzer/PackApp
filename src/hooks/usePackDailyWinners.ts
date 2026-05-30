// usePackDailyWinners — per-(date, category) settled winners for a run.
//
// Sibling to usePackCategoryStandings, which queries the same
// daily_winners table but selects only (category, winner_user_ids) and
// aggregates into per-user counts, discarding score_date. The Daily
// Winner Strip needs the date dimension, so this hook adds it back —
// minimal selection (score_date, category, winner_user_ids), pivoted
// into Record<Category, Map<dateStr, uuid[]>> for O(1) consumer lookup.
//
// Patterns mirrored from usePackCategoryStandings:
//   • useState for data/isLoading/error + refetchKey for invalidation
//   • realtime channel on daily_scores (NOT daily_winners — winners are
//     written by compute_daily_winners_for_pack at view time, so the
//     trigger surface is the same daily_scores changes the standings
//     hook already subscribes to; bumping refetchKey on score change
//     guarantees the strip refreshes when activity is logged)
//   • useScoreStore.logVersion subscription for same-device "just
//     logged" refresh independent of realtime delivery
//   • channelSeq counter for globally-unique channel names
//
// Today (the in-progress day) is excluded from daily_winners by design
// (compute_daily_winners_for_pack settles through yesterday only). The
// strip handles today separately via usePackCategoryStandings's live
// todayByCategory[category].todayLeaderIds — this hook only returns
// settled history.

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { type Category } from "../lib/categories";
import { useScoreStore } from "../stores/scoreStore";

interface DailyWinnerRow {
  score_date: string;
  category: Category;
  winner_user_ids: string[];
}

export type WinnersByCategoryByDate = Record<
  Category,
  Map<string, string[]>
>;

function emptyWinnersMap(): WinnersByCategoryByDate {
  return {
    steps: new Map(),
    workouts: new Map(),
    calories: new Map(),
    water: new Map(),
  };
}

// Monotonic counter — gives each realtime channel a globally-unique
// name (matches the pattern in usePackCategoryStandings).
let channelSeq = 0;

export function usePackDailyWinners(params: {
  packId: string | undefined;
  runId: string | undefined;
}): {
  winnersByCategoryByDate: WinnersByCategoryByDate;
  isLoading: boolean;
  error: string | null;
} {
  const { packId, runId } = params;

  const [winnersByCategoryByDate, setWinners] =
    useState<WinnersByCategoryByDate>(emptyWinnersMap);
  const [isLoading, setIsLoading] = useState<boolean>(!!runId);
  const [error, setError] = useState<string | null>(null);
  const [refetchKey, setRefetchKey] = useState(0);

  const logVersion = useScoreStore((s) => s.logVersion);

  useEffect(() => {
    if (!runId) {
      setWinners(emptyWinnersMap());
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (async () => {
      const { data, error: queryError } = await supabase
        .from("daily_winners")
        .select("score_date, category, winner_user_ids")
        .eq("run_id", runId)
        .neq("category", "legacy");

      if (cancelled) return;
      if (queryError) {
        setWinners(emptyWinnersMap());
        setError(queryError.message);
        setIsLoading(false);
        return;
      }

      const rows = (data ?? []) as DailyWinnerRow[];
      const out = emptyWinnersMap();
      for (const row of rows) {
        // Defensive: a 'legacy' row would have already been filtered by
        // the .neq above, but the Category type doesn't include it so
        // this guard also satisfies TS.
        const bucket = out[row.category];
        if (!bucket) continue;
        bucket.set(row.score_date, row.winner_user_ids);
      }
      setWinners(out);
      setIsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [runId, refetchKey, logVersion]);

  // Realtime — bump refetchKey on any daily_scores change for this run.
  // Watching daily_scores (not daily_winners) is the right hook: the
  // RPC computes winners on-demand and they don't get written by
  // user-driven events directly. A scores change → next refetch reads
  // the freshly-computed winners via the standings/home call paths.
  useEffect(() => {
    if (!runId) return;

    const scoresChannel = supabase
      .channel(`pack-daily-winners-scores-${packId}-${runId}-${++channelSeq}`)
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
      supabase.removeChannel(scoresChannel);
    };
  }, [packId, runId]);

  return { winnersByCategoryByDate, isLoading, error };
}
