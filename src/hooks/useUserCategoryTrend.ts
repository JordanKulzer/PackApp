// useUserCategoryTrend — one user's daily values for a single category
// over the pack's active run. Feeds the (upcoming) Trends chart on the
// public profile screen.
//
// Milestone 1 scope: current week / active run only. Longer ranges
// (4w / 3m / all) are gated to Pro and will land in a Milestone 2 pass
// that extends this hook (or wraps it) — for now, callers pass the
// active runId and get back one run's worth of days.
//
// Pattern mirrors usePackCategoryStandings: useState for data/isLoading/
// error, useEffect with the cancelled-flag cleanup pattern. No realtime
// subscription — trends are a reflective view, not a live scoreboard;
// a re-open re-runs the fetch. If a future requirement makes trends
// react to mid-session logs, add a logVersion dep here (same pattern
// usePackCategoryStandings uses).
//
// Columns: reads the COMPOSITE leaderboard columns — steps_count /
// workout_count / calories_count / water_oz_count — exactly what
// usePackCategoryStandings reads (see lines 234-235 there). This is
// deliberate: the chart must agree with the standings, so any drift
// between "what shows on the leaderboard" and "what the chart plots"
// is impossible by construction. Do NOT switch to manual_* / hk_*
// subsets — those are source-isolated counters, not user-totals.
//
// Gap handling: rows are returned as-fetched, with no zero-fill or
// padding. A day with no daily_scores row is simply absent from the
// result; the chart is responsible for breaking its line on those
// gaps. A 0 in an existing row is a real 0 (user logged nothing that
// day but the row exists, e.g. an HK sync wrote zeros).

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Category } from "../lib/categories";

export interface TrendPoint {
  date: string;
  value: number;
}

interface DailyScoreTrendRow {
  score_date: string;
  steps_count: number | null;
  workout_count: number | null;
  calories_count: number | null;
  water_oz_count: number | null;
}

// Exhaustive switch — adding a Category surfaces a compile error here so
// the column mapping can't silently lag behind a new category.
function valueForCategory(
  row: DailyScoreTrendRow,
  category: Category,
): number {
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

export function useUserCategoryTrend(
  userId: string,
  runId: string | null,
  category: Category,
): {
  points: TrendPoint[];
  isLoading: boolean;
  error: Error | null;
} {
  const [points, setPoints] = useState<TrendPoint[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(runId != null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!runId) {
      setPoints([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        const { data, error: queryError } = await supabase
          .from("daily_scores")
          .select(
            "score_date, steps_count, workout_count, calories_count, water_oz_count",
          )
          .eq("user_id", userId)
          .eq("run_id", runId)
          .order("score_date", { ascending: true });

        if (queryError) throw queryError;
        if (cancelled) return;

        const rows = (data ?? []) as DailyScoreTrendRow[];
        setPoints(
          rows.map((r) => ({
            date: r.score_date,
            value: valueForCategory(r, category),
          })),
        );
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
  }, [userId, runId, category]);

  return { points, isLoading, error };
}
