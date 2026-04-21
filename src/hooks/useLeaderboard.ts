import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import type { LeaderboardEntry } from "../types/database";

export function useLeaderboard(runId: string | null) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLeaderboard = useCallback(async () => {
    if (!runId) return;
    setIsLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from("daily_scores")
      .select(
        `
        user_id,
        total_points,
        streak_days,
        streak_multiplier,
        steps_achieved,
        workout_achieved,
        calories_achieved,
        water_achieved,
        users (
          display_name,
          avatar_url
        )
      `
      )
      .eq("run_id", runId)
      .eq("score_date", new Date().toISOString().split("T")[0])
      .order("total_points", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
    } else {
      const ranked: LeaderboardEntry[] = (data ?? []).map((row, index) => ({
        user_id: row.user_id,
        display_name:
          (row.users as { display_name: string; avatar_url: string | null } | null)
            ?.display_name ?? "Unknown",
        avatar_url:
          (row.users as { display_name: string; avatar_url: string | null } | null)
            ?.avatar_url ?? null,
        total_points: row.total_points,
        streak_days: row.streak_days,
        streak_multiplier: row.streak_multiplier,
        steps_achieved: row.steps_achieved,
        workout_achieved: row.workout_achieved,
        calories_achieved: row.calories_achieved,
        water_achieved: row.water_achieved,
        rank: index + 1,
      }));
      setEntries(ranked);
    }
    setIsLoading(false);
  }, [runId]);

  useEffect(() => {
    if (!runId) return;

    fetchLeaderboard();

    const channel = supabase
      .channel(`leaderboard:${runId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "daily_scores",
          filter: `run_id=eq.${runId}`,
        },
        () => {
          fetchLeaderboard();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [runId, fetchLeaderboard]);

  return { entries, isLoading, error, refetch: fetchLeaderboard };
}
