// Shared sync logic for manual activity logging (steps, workout, calories).
// Water has its own path via syncWaterToDailyScores (water_logs → daily_scores).
// These activities upsert daily_scores directly since there is no separate log table.

import { supabase } from "./supabase";
import { WORKOUT_MAX_DAILY } from "./scoring";
import { computeUserStreak } from "./computeUserStreak";
import { notifyPackMembers } from "./notifications";
import { type CrossingEvent } from "./competitiveDetection";
import { detectAndSendCategoryThreats, type Category } from "./threatNotifications";
import { packToday } from "./packDates";
import { analytics } from "./analytics";
import type { ActivityCategory } from "./activityCategoryMap";

export type ManualActivityType = "steps" | "workout" | "calories";

// Syncs a manual activity to daily_scores for every active pack the user belongs to.
//   delta: amount to ADD for steps/calories; pass 1 for workout (binary achieved)
//   category: only meaningful for activityType="workout"; ignored otherwise
//
// "today" is computed per-pack using the pack's stored IANA timezone so that a
// user at 11:30pm who just tipped into a new UTC day still gets credit for the
// correct local day in their pack.
export async function syncManualActivityToDailyScores(
  userId: string,
  activityType: ManualActivityType,
  delta: number,
  category?: ActivityCategory,
): Promise<CrossingEvent[]> {
  const crossings: CrossingEvent[] = [];
  try {
    const { data: memberships } = await supabase
      .from("pack_members")
      .select("pack_id")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (!memberships?.length) return crossings;

    for (const { pack_id } of memberships) {
      const { data: pack } = await supabase
        .from("packs")
        .select(
          "id, name, steps_enabled, workouts_enabled, calories_enabled, step_target, calorie_target, timezone",
        )
        .eq("id", pack_id)
        .maybeSingle();

      if (!pack) continue;

      const enabled =
        (activityType === "steps" && pack.steps_enabled) ||
        (activityType === "workout" && pack.workouts_enabled) ||
        (activityType === "calories" && pack.calories_enabled);

      if (!enabled) continue;

      // Compute "today" in this pack's timezone
      const packTz: string = pack.timezone ?? "UTC";
      const today = packToday(packTz);

      const { data: run } = await supabase
        .from("runs")
        .select("id")
        .eq("pack_id", pack.id)
        .eq("status", "active")
        .maybeSingle();

      if (!run) continue;

      // Read current row to preserve other goal counts and achieved flags.
      // F.2: SELECT expanded to include manual_*_count and hk_*_count so
      // the additive accumulation can read both source sides. steps_count
      // and calories_count are now DB-generated; reading them is still
      // valid (they return manual + hk) but the writes go to manual_*.
      //
      // Prompt 2 (streak migration): streak_days dropped from the SELECT —
      // milestone gating reads the user's GLOBAL streak from users.current_streak
      // below, not from this per-pack row.
      const { data: existing } = await supabase
        .from("daily_scores")
        .select(
          "total_points, manual_steps_count, manual_calories_count, hk_steps_count, hk_calories_count, workout_count, steps_achieved, workout_achieved, calories_achieved, water_achieved",
        )
        .eq("run_id", run.id)
        .eq("user_id", userId)
        .eq("score_date", today)
        .maybeSingle();

      // Prompt 2: prevStreak comes from users.current_streak, read BEFORE
      // computeUserStreak runs below. That guarantees the value is the
      // streak as it stood prior to this log — milestone-crossing
      // detection compares this against the post-log return from
      // computeUserStreak.
      const { data: prevUserStreakRow } = await supabase
        .from("users")
        .select("current_streak")
        .eq("id", userId)
        .maybeSingle();
      const prevStreak =
        (prevUserStreakRow as { current_streak?: number } | null)
          ?.current_streak ?? 0;

      // F.2: source-isolated counters. Manual writes go to manual_*_count;
      // HK writes go to hk_*_count; daily_scores.steps_count and
      // .calories_count are DB-generated as the sum (migration 20260513b).
      let newManualSteps    = existing?.manual_steps_count ?? 0;
      let newManualCalories = existing?.manual_calories_count ?? 0;
      const prevHkSteps     = existing?.hk_steps_count ?? 0;
      const prevHkCalories  = existing?.hk_calories_count ?? 0;
      let newWorkoutCount  = existing?.workout_count ?? 0;
      let steps_achieved   = existing?.steps_achieved ?? false;
      let workout_achieved = existing?.workout_achieved ?? false;
      let calories_achieved = existing?.calories_achieved ?? false;
      const water_achieved  = existing?.water_achieved ?? false;

      // F.2: wasAchievedBefore retained for the Pass 9 analytics
      // transition gate only. The feed-row INSERT no longer gates on
      // it — every manual log produces an audit-trail row regardless
      // of goal-cross state (Bug 6 fix below).
      const wasAchievedBefore =
        activityType === "steps"   ? steps_achieved :
        activityType === "workout" ? workout_achieved :
                                     calories_achieved;

      if (activityType === "steps") {
        newManualSteps = (existing?.manual_steps_count ?? 0) + delta;
        steps_achieved = (newManualSteps + prevHkSteps) >= (pack.step_target ?? Infinity);
      } else if (activityType === "workout") {
        // Pass 25-followup-C: cap-blocking throw removed. workout_count
        // can grow past WORKOUT_MAX_DAILY (user records what happened);
        // points are capped via workoutPoints(newWorkoutCount) below
        // (Math.min(count, WORKOUT_MAX_DAILY) * POINTS.workout).
        const currentCount = existing?.workout_count ?? 0;
        newWorkoutCount = currentCount + 1;
        workout_achieved = true;
      } else {
        newManualCalories = (existing?.manual_calories_count ?? 0) + delta;
        calories_achieved = (newManualCalories + prevHkCalories) >= (pack.calorie_target ?? Infinity);
      }

      // Only send fields that changed — avoids clearing other fields that
      // daily_scores may have set via HealthKit sync. Prompt 2: streak_days
      // no longer written; the per-user GLOBAL streak (users.current_streak)
      // is the source of truth and is recomputed below.
      const upsertPayload: Record<string, unknown> = {
        run_id: run.id,
        user_id: userId,
        score_date: today,
        updated_at: new Date().toISOString(),
      };

      // F.2: write to manual_*_count only. steps_count / calories_count
      // are DB-generated as (manual + hk) — writes against them would
      // fail. M-badge derives client-side from manual_*_count > 0
      // (was the has_manual_* booleans, now dropped).
      if (activityType === "steps") {
        upsertPayload.manual_steps_count = newManualSteps;
        upsertPayload.steps_achieved = steps_achieved;
      } else if (activityType === "workout") {
        upsertPayload.workout_count = newWorkoutCount;
        upsertPayload.workout_achieved = workout_achieved;
      } else {
        upsertPayload.manual_calories_count = newManualCalories;
        upsertPayload.calories_achieved = calories_achieved;
      }

      const { error } = await supabase
        .from("daily_scores")
        .upsert(upsertPayload, { onConflict: "run_id,user_id,score_date" });

      if (error) {
        console.error("[logActivity] daily_scores upsert error:", error);
        continue;
      }

      // Prompt 2 (streak migration): recompute the per-user GLOBAL streak
      // after every successful daily_scores write. AWAITED so the return
      // value (post-log streak) can feed analytics + milestone gating
      // below. computeUserStreak has a top-level try/catch and provably
      // never throws — returns 0 on internal failure — but we wrap
      // defensively here so any unforeseen exception cannot break the log.
      let newStreak = prevStreak;
      try {
        newStreak = await computeUserStreak(userId);
      } catch {
        // Defensive: leave newStreak as prevStreak if compute failed —
        // analytics + milestone detection silently no-op (no crossing).
      }

      // Categories pivot (Stage 2C): per-category passed_you / tied_you
      // threats. One CategoryDelta per call — this path logs one activity
      // type. Workouts has no separate HK lane in the manual logger;
      // workout_count is the unified before/after value.
      const threatCategory: Category =
        activityType === "steps"
          ? "steps"
          : activityType === "workout"
            ? "workouts"
            : "calories";
      const threatBefore =
        activityType === "steps"
          ? (existing?.manual_steps_count ?? 0) + prevHkSteps
          : activityType === "workout"
            ? (existing?.workout_count ?? 0)
            : (existing?.manual_calories_count ?? 0) + prevHkCalories;
      const threatAfter =
        activityType === "steps"
          ? newManualSteps + prevHkSteps
          : activityType === "workout"
            ? newWorkoutCount
            : newManualCalories + prevHkCalories;
      detectAndSendCategoryThreats(userId, pack.id, run.id, packTz, [
        {
          category: threatCategory,
          beforeValue: threatBefore,
          afterValue: threatAfter,
        },
      ]).catch(() => {});

      // Feed event: once per day per pack, only when goal is newly crossed
      const nowAchieved =
        activityType === "steps"   ? steps_achieved :
        activityType === "workout" ? workout_achieved :
                                     calories_achieved;

      // ── Pass 9 funnel: activity_logged + streak_milestone ──
      // Transition gate uses `existing` (fresh DB read at the top of this
      // iteration) — never in-memory state mutated below the upsert.
      // wasAchievedBefore / nowAchieved already encode that transition for
      // the current activity_type.
      if (nowAchieved && !wasAchievedBefore) {
        const goalHitToday = steps_achieved || workout_achieved || calories_achieved || water_achieved;
        // Stage 2A: points_earned hard-zeroed and is_first_ever degraded to
        // false — the points-based first-ever gate is gone with the POINTS
        // table. A later sub-stage rebuilds is_first_ever on categories data.
        analytics.activityLogged({
          activity_type: activityType,
          source: "manual",
          points_earned: 0,
          is_first_ever: false,
          // Prompt 2: streak_days_after is now the user's GLOBAL streak
          // returned by computeUserStreak above, not the per-run value.
          streak_days_after: newStreak,
          goal_hit_today: goalHitToday,
        });
      }

      // Highest crossed streak milestone, fire once per upsert max.
      // Prompt 2: prev/new both come from the GLOBAL streak now (prevStreak
      // pre-read from users.current_streak; newStreak from computeUserStreak).
      const STREAK_MILESTONES = [3, 7, 14, 30, 60, 90] as const;
      let crossedMilestone: 3 | 7 | 14 | 30 | 60 | 90 | null = null;
      let priorMilestone = 0;
      for (const m of STREAK_MILESTONES) {
        if (prevStreak >= m) priorMilestone = m;
        if (prevStreak < m && newStreak >= m) crossedMilestone = m;
      }
      if (crossedMilestone) {
        analytics.streakMilestone({
          milestone_days: crossedMilestone,
          pack_id: pack.id,
          prior_milestone_days: priorMilestone,
        });
      }

      // F.2 Bug 6: every manual log produces an audit-trail row. The
      // prior `if (nowAchieved)` wrapper + `!wasAchievedBefore` gate
      // silently swallowed sub-target + post-cross logs. Now: workout
      // still capped at WORKOUT_MAX_DAILY (product-intentional);
      // steps/calories produce a row on every call. Index narrowing
      // in migration 20260513b ensures no 23505 from the dedup index.
      // value stores the per-action delta — what the user just added in
      // THIS call — not the cumulative manual total. The cumulative total
      // lives in daily_scores.manual_*_count (the additive write target).
      // FeedItemRow renders this as "logged X steps", which reads
      // naturally as the action amount. HK feed rows store cumulative
      // because they fire per goal-cross, not per sync — that asymmetry
      // is intentional and matches the event semantics on each side.
      const value =
        activityType === "steps"   ? delta :
        activityType === "workout" ? newWorkoutCount :
                                     delta;

      let shouldInsertFeed = false;
      if (activityType === "workout") {
        const { count: existingCount } = await supabase
          .from("activity_feed")
          .select("id", { count: "exact", head: true })
          .eq("pack_id", pack.id)
          .eq("user_id", userId)
          .eq("activity_type", "workout")
          .eq("score_date", today);
        shouldInsertFeed = (existingCount ?? 0) < WORKOUT_MAX_DAILY;
      } else {
        // Manual steps/calories: every action gets a row (additive
        // audit trail per F.2 locked product model).
        shouldInsertFeed = true;
      }

      if (shouldInsertFeed) {
        // 23505 try/catch kept defensively. Post-F.2-narrowing the
        // partial unique index covers only (took_lead, all_goals), so
        // 23505 cannot fire from this path — but the conditional
        // is cheap insurance against any future schema re-tightening.
        const { data: insertedRows, error: feedError } = await supabase
          .from("activity_feed")
          .insert({
            pack_id: pack.id,
            user_id: userId,
            activity_type: activityType,
            value,
            points_earned: 0,
            entry_method: "manual",
            score_date: today,
            category: activityType === "workout" ? (category ?? "other") : null,
          })
          .select("id");

        if (feedError) {
          if (feedError.code !== "23505") {
            console.error("[logActivity] activity_feed insert error:", feedError);
          }
        } else if (insertedRows && insertedRows.length > 0) {
          crossings.push({
            packId: pack.id,
            packName: pack.name,
            packTimezone: packTz,
            feedItemId: insertedRows[0].id,
            activityType,
            pointsEarned: 0,
            scoreDate: today,
          });
          notifyPackMembers(userId, pack.id, {
            kind: "goal",
            activityType,
          }).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.error("[logActivity] syncManualActivityToDailyScores error:", err);
  }
  return crossings;
}
