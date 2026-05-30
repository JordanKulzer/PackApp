// usePackCategoryTrend — multi-member daily values per category over a
// pack's active run. The data layer for the upcoming Compete-tab chart.
//
// This is useUserCategoryTrend generalized to all members of the pack:
// same daily_scores table, same composite category columns (steps_count,
// workout_count, calories_count, water_oz_count) so the chart can't
// drift from the leaderboard — but the user_id filter is dropped and the
// fetched rows are pivoted in JS by user × category.
//
// Realtime + refetch parity with usePackCategoryStandings: one supabase
// channel on daily_scores filtered by run_id, plus a useScoreStore
// logVersion subscription. The chart refetches on the same triggers
// the standings do, so the two surfaces never disagree.
//
// Gaps are preserved as-fetched — a member with no daily_scores row for
// a given day simply has no point for that date. The consumer (and the
// chart) is responsible for rendering gaps as broken lines (mirrors the
// useUserCategoryTrend / CategoryTrendChart contract). Members with
// zero daily_scores rows in the result are absent from every category's
// series; the consumer reconciles against the full roster.

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { CATEGORIES, type Category } from "../lib/categories";
import { useScoreStore } from "../stores/scoreStore";

export type PackTrendPoint = { date: string; value: number };

export type MemberCategoryTrend = {
  userId: string;
  points: PackTrendPoint[];
};

export type UsePackCategoryTrendResult = {
  // All four categories always present as keys; consumer decides which
  // tabs to show based on the pack's enabled set.
  seriesByCategory: Record<Category, MemberCategoryTrend[]>;
  isLoading: boolean;
  error: string | null;
};

// Row shape selected from daily_scores. Counts typed nullable because
// daily_scores rows can carry NULLs before any sync has populated a
// category — `?? 0` collapses to a real zero, same convention as
// useUserCategoryTrend's valueForCategory.
interface DailyScoreRow {
  user_id: string;
  score_date: string;
  steps_count: number | null;
  workout_count: number | null;
  calories_count: number | null;
  water_oz_count: number | null;
}

// Exhaustive switch — adding a Category surfaces a compile error here.
// Mirrors useUserCategoryTrend's valueForCategory exactly so the column
// mapping can't drift between the single-user and multi-user paths.
function valueForCategory(row: DailyScoreRow, category: Category): number {
  switch (category) {
    case "steps":
      return row.steps_count ?? 0;
    case "workouts":
      return row.workout_count ?? 0;
    case "calories":
      return row.calories_count ?? 0;
    case "water":
      return row.water_oz_count ?? 0;
  }
}

// Fresh per-category result map, all four categories pre-keyed to [].
function emptySeriesByCategory(): Record<Category, MemberCategoryTrend[]> {
  return {
    steps: [],
    workouts: [],
    calories: [],
    water: [],
  };
}

// Pivot the flat row list into per-category, per-user series. Rows are
// already ordered ascending by score_date (the query enforces it), so
// the per-user points arrays inherit that order — no per-user re-sort
// needed. Pure function so it stays trivially testable.
function buildSeriesByCategory(
  rows: DailyScoreRow[],
): Record<Category, MemberCategoryTrend[]> {
  const out = emptySeriesByCategory();
  for (const category of CATEGORIES) {
    // Map userId → points array under construction. Preserves insertion
    // order, which is the score_date asc order from the query — same
    // as the per-user order in useUserCategoryTrend.
    const byUser = new Map<string, PackTrendPoint[]>();
    for (const row of rows) {
      let arr = byUser.get(row.user_id);
      if (!arr) {
        arr = [];
        byUser.set(row.user_id, arr);
      }
      arr.push({
        date: row.score_date,
        value: valueForCategory(row, category),
      });
    }
    out[category] = Array.from(byUser, ([userId, points]) => ({
      userId,
      points,
    }));
  }
  return out;
}

// Monotonic counter — gives each realtime channel a globally-unique
// name so concurrent hook instances / effect re-runs never share a
// channel. Mirrors usePackCategoryStandings exactly.
let channelSeq = 0;

export function usePackCategoryTrend(params: {
  packId: string | undefined;
  runId: string | undefined;
}): UsePackCategoryTrendResult {
  const { packId, runId } = params;

  const [seriesByCategory, setSeriesByCategory] = useState<
    Record<Category, MemberCategoryTrend[]>
  >(() => emptySeriesByCategory());
  const [isLoading, setIsLoading] = useState<boolean>(!!runId);
  const [error, setError] = useState<string | null>(null);
  const [refetchKey, setRefetchKey] = useState(0);

  // Same-device "just logged" signal. Bumping useScoreStore.logVersion
  // after each manual log forces this hook to refetch deterministically,
  // independent of realtime delivery — exactly the trick
  // usePackCategoryStandings uses.
  const logVersion = useScoreStore((s) => s.logVersion);

  useEffect(() => {
    if (!runId) {
      setSeriesByCategory(emptySeriesByCategory());
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (async () => {
      const { data, error: queryError } = await supabase
        .from("daily_scores")
        .select(
          "user_id, score_date, steps_count, workout_count, calories_count, water_oz_count",
        )
        .eq("run_id", runId)
        .order("score_date", { ascending: true });

      if (cancelled) return;
      if (queryError) {
        setSeriesByCategory(emptySeriesByCategory());
        setError(queryError.message);
        setIsLoading(false);
        return;
      }

      const rows = (data ?? []) as DailyScoreRow[];
      setSeriesByCategory(buildSeriesByCategory(rows));
      setIsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [runId, refetchKey, logVersion]);

  // Realtime: one channel on daily_scores for this run, bumps
  // refetchKey on any change so the data-fetch effect above re-runs.
  // Keyed on [packId, runId] only — the channel is created once per
  // run, not torn down on every refetch. Mirrors the standings hook's
  // scoresChannel exactly (event:"*", schema:"public", same filter
  // shape, same unique-name pattern via ++channelSeq).
  useEffect(() => {
    if (!runId) return;

    const scoresChannel = supabase
      .channel(`pack-cat-trend-scores-${packId}-${runId}-${++channelSeq}`)
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

  return { seriesByCategory, isLoading, error };
}
