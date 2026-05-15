// Pass 25-followup-E.2.a.ii — lib-side took_lead detection.
//
// Pure function callable from any path (LogSheet handlers, HK auto-sync,
// background observer wake) — drops the prevRankRef closure dependency
// fetchFeedback historically used. Dedup source is the partial unique
// index idx_activity_feed_no_dup_goals on (user_id, pack_id, activity_type,
// score_date): a 23505 unique-violation means same-day re-take → silent
// no-op. Lets cold-launch first-action took_leads fire correctly (the
// prevRank=null gate in fetchFeedback used to skip those) and resolves
// HK auto-sync's took_lead silence (previously only fetchFeedback wrote
// the activity_feed row, and HK paths don't go through fetchFeedback).
//
// Single source of truth for took_lead INSERT + push as of Pass
// 25-followup-E.2.a.iii. fetchFeedback in LogSheet.tsx retains only the
// banner-state update (rank text); threatNotifications retains only the
// victim-targeted threats (passed_you / tied_you / one_action_away).
// Per-day dedup via the partial unique index ensures one row + one push
// per (user, pack, day) — matches the migration 20260429 intent.

import { supabase } from "./supabase";
import { packToday } from "./packDates";
import { notifyPackMembers } from "./notifications";

export type CrossingActivityType =
  | "steps"
  | "workout"
  | "calories"
  | "water"
  | "all_goals"
  | "took_lead";

// Per-pack record emitted by sync functions for each activity_feed row
// they successfully insert. Consumers (E.2.a.iii / E.2.b) iterate to
// build achievement-prompt UX, multi-pack fan-out, etc.
export type CrossingEvent = {
  packId: string;
  packName: string;
  packTimezone: string;
  feedItemId: string;
  activityType: CrossingActivityType;
  pointsEarned: number;
  scoreDate: string;
};

export type TookLeadResult = {
  feedItemId: string;
  myWeeklyPoints: number;
  leadPoints: number; // strict gap to #2; 0 returns null (tie suppression)
};

export async function detectAndRecordTookLead(
  userId: string,
  packId: string,
  runId: string,
  packTimezone: string,
): Promise<TookLeadResult | null> {
  const today = packToday(packTimezone);

  // Aggregate weekly_points across the whole run (matches the leaderboard's
  // rank source — see fetchFeedback / useLeaderboard / threatNotifications
  // for the established pattern). Ranking by today-only daily_scores rows
  // produced the false took_lead bug E.1-fix corrected.
  const { data: rows } = await supabase
    .from("daily_scores")
    .select("user_id, total_points")
    .eq("run_id", runId);
  if (!rows?.length) return null;

  const weekly: Record<string, number> = {};
  for (const r of rows) {
    weekly[r.user_id] = (weekly[r.user_id] ?? 0) + r.total_points;
  }
  const sorted = Object.entries(weekly)
    .map(([uid, pts]) => ({ uid, pts }))
    .sort((a, b) => b.pts - a.pts);

  const myEntry = sorted.find((e) => e.uid === userId);
  if (!myEntry || sorted[0].uid !== userId) return null;

  // Tie suppression: a tie isn't a lead. Matches threatNotifications's
  // actorIsNowStrictlyAhead gate so both detectors agree on semantics.
  const leadPoints = myEntry.pts - (sorted[1]?.pts ?? 0);
  if (leadPoints === 0) return null;

  // INSERT with the partial unique index as the dedup source. Same race-
  // safety pattern as syncWater.ts and logActivity.ts: 23505 is the
  // expected outcome on same-day re-takes; other errors surface.
  const { data: insertedRows, error } = await supabase
    .from("activity_feed")
    .insert({
      pack_id: packId,
      user_id: userId,
      activity_type: "took_lead",
      // Pass F.1: `value` carries the lead gap (myEntry.pts - secondPlace.pts).
      // `points_earned` stays 0 — took_lead is an achievement event, not a
      // scoring event. daily_scores already holds the canonical pts total.
      // Display surfaces read `value` for the subtitle and suppress the
      // pts pill entirely for took_lead rows.
      value: leadPoints,
      points_earned: 0,
      entry_method: "system",
      score_date: today,
    })
    .select("id");

  if (error) {
    if (error.code !== "23505") {
      console.error("[competitiveDetection] took_lead insert error:", error);
    }
    return null;
  }
  if (!insertedRows?.length) return null;

  // Pass 25-followup-E.2.a.iii: lib now owns push. threatNotifications no
  // longer emits took_lead — only victim-targeted threats (passed_you /
  // tied_you / one_action_away). The partial unique index gates this push
  // at one fire per (user, pack, day) — strictly aligned with the migration
  // 20260429 intent comment.
  notifyPackMembers(userId, packId, { kind: "took_lead" }).catch(() => {});

  return {
    feedItemId: insertedRows[0].id,
    myWeeklyPoints: myEntry.pts,
    leadPoints,
  };
}

// Pass 25-followup-E.2.b.iii-fix-2: read-only weekly-rank check. Mirrors
// detectAndRecordTookLead's aggregation + tie-suppression semantics, but
// performs no writes. Used by useUnpostedAchievements to gate the
// HomeAchievementBanner so historic took_lead rows stop surfacing once the
// user loses the lead — the banner is the "share NOW" affordance, not a
// backlog. Returns true only when the user is currently #1 with a strict
// lead (matches the actorIsNowStrictlyAhead semantics used elsewhere).
export async function isCurrentlyLeading(
  userId: string,
  runId: string,
): Promise<boolean> {
  const { data: rows } = await supabase
    .from("daily_scores")
    .select("user_id, total_points")
    .eq("run_id", runId);
  if (!rows?.length) return false;

  const weekly: Record<string, number> = {};
  for (const r of rows) {
    weekly[r.user_id] = (weekly[r.user_id] ?? 0) + r.total_points;
  }
  const sorted = Object.entries(weekly)
    .map(([uid, pts]) => ({ uid, pts }))
    .sort((a, b) => b.pts - a.pts);

  if (sorted[0]?.uid !== userId) return false;
  const lead = sorted[0].pts - (sorted[1]?.pts ?? 0);
  return lead > 0;
}
