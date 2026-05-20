import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { subscribeToAchievementInserts } from "../lib/realtimeSubscriptions";

// Pass 25-followup-E.2.b.iii: generalized from useUnpostedWins (daily_winner-
// only) to query all achievement kinds within the 2-day posting window. The
// hook is the universe of unposted rows; per-kind activation is the
// consumer's responsibility (HomeAchievementBanner filters to its active
// kinds + gates on FEATURE_FLAGS.achievementPrompts; the legacy
// per-pack-card daily_winner banner in home.tsx filters to kind === "daily_winner"
// + gates on FEATURE_FLAGS.dailyWinner). Both consumers receive the same
// query result; flag gates stay separate.
//
// Realtime: subscribes to activity_feed INSERTs for this user so a new
// achievement (from detectAndRecordTookLead or future HK paths) refetches
// the query immediately — banner appears without focus or refresh.

export type UnpostedAchievementKind = "daily_winner" | "took_lead" | "all_goals";

export interface UnpostedAchievement {
  feedItemId: string;
  kind: UnpostedAchievementKind;
  packId: string;
  packName: string;
  scoreDate: string;
  pointsEarned: number;
  createdAt: string;
  leadGap?: number;        // took_lead only: weekly points gap to #2
  opponentName?: string;   // took_lead only: display_name of #2 at hydration time
}

function getYesterdayInTz(timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === "year")!.value;
    const mo = parts.find((p) => p.type === "month")!.value;
    const d = parseInt(parts.find((p) => p.type === "day")!.value, 10) - 1;
    const yesterday = new Date(`${y}-${mo}-01T00:00:00`);
    yesterday.setDate(d);
    return yesterday.toISOString().slice(0, 10);
  } catch {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }
}

// Kind-aware date filter. daily_winner is conceptually a yesterday-only
// concept (announced after the day closes); took_lead and all_goals fire
// today and remain valid for sharing throughout the 2-day window.
function passesDateFilter(
  kind: UnpostedAchievementKind,
  scoreDate: string,
  packTz: string,
): boolean {
  if (kind === "daily_winner") {
    return scoreDate === getYesterdayInTz(packTz);
  }
  return true; // took_lead, all_goals — any row within the query window
}

export function useUnpostedAchievements(userId: string | undefined): {
  achievements: UnpostedAchievement[];
  loading: boolean;
  refresh: () => void;
} {
  const [achievements, setAchievements] = useState<UnpostedAchievement[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAchievements = useCallback(async () => {
    if (!userId) {
      setAchievements([]);
      return;
    }
    setLoading(true);

    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    const { data, error } = await supabase
      .from("activity_feed")
      .select(
        "id, pack_id, activity_type, score_date, points_earned, value, created_at, packs(name, timezone)",
      )
      .eq("user_id", userId)
      .in("activity_type", ["daily_winner", "took_lead", "all_goals"])
      .is("photo_url", null)
      .gte("score_date", twoDaysAgo.toISOString().slice(0, 10))
      .order("created_at", { ascending: false });

    if (error || !data) {
      setLoading(false);
      return;
    }

    const result: UnpostedAchievement[] = [];
    for (const row of data) {
      const pack = row.packs as unknown as { name: string; timezone: string } | null;
      const tz = pack?.timezone ?? "UTC";
      const kind = row.activity_type as UnpostedAchievementKind;
      if (!passesDateFilter(kind, row.score_date, tz)) continue;
      // Categories pivot (Stage 2B): took_lead is dropped — the
      // isCurrentlyLeading gate + points-based opponent/leadGap resolution
      // are gone. Surviving took_lead rows are historical; they fall
      // through as plain achievements with no leadGap/opponentName.
      result.push({
        feedItemId: row.id,
        kind,
        packId: row.pack_id,
        packName: pack?.name ?? "Pack",
        scoreDate: row.score_date,
        pointsEarned: row.points_earned,
        createdAt: row.created_at,
      });
    }

    setAchievements(result);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetchAchievements();
  }, [fetchAchievements]);

  // Live refresh on new achievement INSERTs (e.g., took_lead from a fresh
  // rank crossing while the user is on Home).
  useEffect(() => {
    if (!userId) return;
    return subscribeToAchievementInserts(
      userId,
      () => {
        fetchAchievements();
      },
      "unposted-achievements",
    );
  }, [userId, fetchAchievements]);

  return { achievements, loading, refresh: fetchAchievements };
}
