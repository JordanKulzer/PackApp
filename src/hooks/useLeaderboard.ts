import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { packToday } from "../lib/packDates";
import type { LeaderboardEntry } from "../types/database";

export function useLeaderboard(
  runId: string | null,
  packId: string | null,
  packTimezone: string = "UTC",
) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLeaderboard = useCallback(async () => {
    if (!runId) return;
    setIsLoading(true);
    setError(null);

    // Fetch all active pack members (with display names + avatars) in parallel
    // with the full run's daily_scores (for weekly totals) and today's scores
    // (for goal achievement flags).
    const [membersResult, weeklyResult, todayResult] = await Promise.all([
      packId
        ? supabase
            .from("pack_members")
            .select("user_id, users(display_name, avatar_url)")
            .eq("pack_id", packId)
            .eq("is_active", true)
        : Promise.resolve({ data: [] as { user_id: string; users: { display_name: string; avatar_url: string | null } | null }[] }),
      supabase
        .from("daily_scores")
        .select("user_id, total_points")
        .eq("run_id", runId),
      supabase
        .from("daily_scores")
        .select(
          "user_id, streak_days, streak_multiplier, steps_achieved, workout_achieved, calories_achieved, water_achieved"
        )
        .eq("run_id", runId)
        .eq("score_date", packToday(packTimezone)),
    ]);

    if (membersResult.error || weeklyResult.error) {
      setError((membersResult.error ?? weeklyResult.error)!.message);
      setIsLoading(false);
      return;
    }

    // Aggregate weekly totals per user across all run dates
    const weeklyTotals: Record<string, number> = {};
    (weeklyResult.data ?? []).forEach((row) => {
      weeklyTotals[row.user_id] = (weeklyTotals[row.user_id] ?? 0) + row.total_points;
    });

    // Index today's goal data by user
    const todayByUser: Record<string, {
      streak_days: number;
      streak_multiplier: number;
      steps_achieved: boolean;
      workout_achieved: boolean;
      calories_achieved: boolean;
      water_achieved: boolean;
    }> = {};
    (todayResult.data ?? []).forEach((row) => {
      todayByUser[row.user_id] = row;
    });

    // Build all-members list from pack_members, or fall back to scorers only
    const memberList = (membersResult.data ?? []).length > 0
      ? (membersResult.data ?? []).map((m) => ({
          user_id: m.user_id,
          display_name:
            (m.users as { display_name: string; avatar_url: string | null } | null)
              ?.display_name ?? "Unknown",
          avatar_url:
            (m.users as { display_name: string; avatar_url: string | null } | null)
              ?.avatar_url ?? null,
        }))
      : Object.keys(weeklyTotals).map((uid) => ({
          user_id: uid,
          display_name: "Unknown",
          avatar_url: null,
        }));

    // Sort: weekly_points DESC, then display_name ASC (alpha for deterministic tie order)
    const sorted = [...memberList].sort((a, b) => {
      const ptsDiff = (weeklyTotals[b.user_id] ?? 0) - (weeklyTotals[a.user_id] ?? 0);
      if (ptsDiff !== 0) return ptsDiff;
      return a.display_name.localeCompare(b.display_name);
    });

    // Dense rank by weekly_points only
    let lastPts = -1;
    let lastRank = 0;
    const ranked: LeaderboardEntry[] = sorted.map((member, i) => {
      const pts = weeklyTotals[member.user_id] ?? 0;
      if (pts !== lastPts) { lastRank = i + 1; lastPts = pts; }
      const today = todayByUser[member.user_id];
      return {
        user_id: member.user_id,
        display_name: member.display_name,
        avatar_url: member.avatar_url,
        total_points: pts,
        streak_days: today?.streak_days ?? 0,
        streak_multiplier: today?.streak_multiplier ?? 1,
        steps_achieved: today?.steps_achieved ?? false,
        workout_achieved: today?.workout_achieved ?? false,
        calories_achieved: today?.calories_achieved ?? false,
        water_achieved: today?.water_achieved ?? false,
        rank: lastRank,
      };
    });

    setEntries(ranked);
    setIsLoading(false);
  }, [runId, packId, packTimezone]);

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
  }, [runId, packId, packTimezone, fetchLeaderboard]);

  return { entries, isLoading, error, refetch: fetchLeaderboard };
}
