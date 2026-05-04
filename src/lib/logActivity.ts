// Shared sync logic for manual activity logging (steps, workout, calories).
// Water has its own path via syncWaterToDailyScores (water_logs → daily_scores).
// These activities upsert daily_scores directly since there is no separate log table.

import { supabase } from "./supabase";
import { POINTS, WORKOUT_MAX_DAILY, workoutPoints, getStreakMultiplier } from "./scoring";
import { computeStreakForRun } from "./computeStreak";
import { notifyPackMembers } from "./notifications";
import { detectAndSendThreatNotifications } from "./threatNotifications";
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
): Promise<void> {
  try {
    const { data: memberships } = await supabase
      .from("pack_members")
      .select("pack_id")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (!memberships?.length) return;

    for (const { pack_id } of memberships) {
      const { data: pack } = await supabase
        .from("packs")
        .select(
          "id, steps_enabled, workouts_enabled, calories_enabled, step_target, calorie_target, timezone",
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
      // streak_days included for Pass 9 streak_milestone gating — must come
      // from this fresh DB read, never from in-memory state.
      const { data: existing } = await supabase
        .from("daily_scores")
        .select(
          "total_points, steps_count, calories_count, workout_count, steps_achieved, workout_achieved, calories_achieved, water_achieved, streak_days",
        )
        .eq("run_id", run.id)
        .eq("user_id", userId)
        .eq("score_date", today)
        .maybeSingle();
      const prevStreakDays = existing?.streak_days ?? 0;
      const oldTotalPoints = existing?.total_points ?? 0;

      // Compute new count and achieved flags
      let newStepsCount    = existing?.steps_count ?? 0;
      let newCaloriesCount = existing?.calories_count ?? 0;
      let newWorkoutCount  = existing?.workout_count ?? 0;
      let steps_achieved   = existing?.steps_achieved ?? false;
      let workout_achieved = existing?.workout_achieved ?? false;
      let calories_achieved = existing?.calories_achieved ?? false;
      const water_achieved  = existing?.water_achieved ?? false;

      const wasAchievedBefore =
        activityType === "steps"   ? steps_achieved :
        activityType === "workout" ? workout_achieved :
                                     calories_achieved;

      if (activityType === "steps") {
        newStepsCount = (existing?.steps_count ?? 0) + delta;
        steps_achieved = newStepsCount >= (pack.step_target ?? Infinity);
      } else if (activityType === "workout") {
        const currentCount = existing?.workout_count ?? 0;
        if (currentCount >= WORKOUT_MAX_DAILY) {
          throw new Error(
            `You've already logged ${WORKOUT_MAX_DAILY} workouts today — max ${WORKOUT_MAX_DAILY} per day.`,
          );
        }
        newWorkoutCount = currentCount + 1;
        workout_achieved = true;
      } else {
        newCaloriesCount = (existing?.calories_count ?? 0) + delta;
        calories_achieved = newCaloriesCount >= (pack.calorie_target ?? Infinity);
      }

      const anyAchieved = steps_achieved || workout_achieved || calories_achieved || water_achieved;
      const streakDays = await computeStreakForRun(userId, run.id, today, anyAchieved, packTz);
      const multiplier = getStreakMultiplier(streakDays);

      const newTotalPoints = Math.round(
        ((steps_achieved   ? POINTS.steps   : 0) +
         workoutPoints(newWorkoutCount) +
         (calories_achieved ? POINTS.calories : 0) +
         (water_achieved   ? POINTS.water    : 0)) * multiplier,
      );

      // Only send fields that changed — avoids clearing streak or other fields
      // that daily_scores may have set via HealthKit sync
      const upsertPayload: Record<string, unknown> = {
        run_id: run.id,
        user_id: userId,
        score_date: today,
        total_points: newTotalPoints,
        streak_days: streakDays,
        streak_multiplier: multiplier,
        updated_at: new Date().toISOString(),
      };

      if (activityType === "steps") {
        upsertPayload.steps_count = newStepsCount;
        upsertPayload.steps_achieved = steps_achieved;
        upsertPayload.has_manual_steps = true;
      } else if (activityType === "workout") {
        upsertPayload.workout_count = newWorkoutCount;
        upsertPayload.workout_achieved = workout_achieved;
      } else {
        upsertPayload.calories_count = newCaloriesCount;
        upsertPayload.calories_achieved = calories_achieved;
        upsertPayload.has_manual_calories = true;
      }

      const { error } = await supabase
        .from("daily_scores")
        .upsert(upsertPayload, { onConflict: "run_id,user_id,score_date" });

      if (error) {
        console.error("[logActivity] daily_scores upsert error:", error);
        continue;
      }

      const todayDelta = newTotalPoints - (existing?.total_points ?? 0);
      if (todayDelta > 0) {
        detectAndSendThreatNotifications(userId, pack.id, run.id, todayDelta).catch(() => {});
      }

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
        let isFirstEver = false;
        if (oldTotalPoints === 0 && newTotalPoints > 0) {
          const { count } = await supabase
            .from("daily_scores")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .gt("total_points", 0);
          isFirstEver = (count ?? 0) <= 1;
        }
        const goalHitToday = steps_achieved || workout_achieved || calories_achieved || water_achieved;
        const pointsForActivity =
          activityType === "steps"   ? POINTS.steps :
          activityType === "workout" ? POINTS.workout :
                                       POINTS.calories;
        analytics.activityLogged({
          activity_type: activityType,
          source: "manual",
          points_earned: Math.round(pointsForActivity * multiplier),
          is_first_ever: isFirstEver,
          streak_days_after: streakDays,
          goal_hit_today: goalHitToday,
        });
      }

      // Highest crossed streak milestone, fire once per upsert max.
      const STREAK_MILESTONES = [3, 7, 14, 30, 60, 90] as const;
      let crossedMilestone: 3 | 7 | 14 | 30 | 60 | 90 | null = null;
      let priorMilestone = 0;
      for (const m of STREAK_MILESTONES) {
        if (prevStreakDays >= m) priorMilestone = m;
        if (prevStreakDays < m && streakDays >= m) crossedMilestone = m;
      }
      if (crossedMilestone) {
        analytics.streakMilestone({
          milestone_days: crossedMilestone,
          pack_id: pack.id,
          prior_milestone_days: priorMilestone,
        });
      }

      if (nowAchieved) {
        const basePoints =
          activityType === "steps"   ? POINTS.steps :
          activityType === "workout" ? POINTS.workout :
                                       POINTS.calories;
        const pointsEarned = Math.round(basePoints * multiplier);
        const value =
          activityType === "steps"   ? newStepsCount :
          activityType === "workout" ? newWorkoutCount :
                                       newCaloriesCount;

        // Workouts: allow up to WORKOUT_MAX_DAILY feed entries per day.
        // Manual workouts have no HealthKit UUID, so the partial unique
        // index on (user_id, healthkit_uuid) doesn't apply — the
        // count-gate is the only daily-cap enforcement here.
        // All other activities: idempotent upsert on the per-day partial
        // unique index. ignoreDuplicates turns concurrent races into
        // silent no-ops.
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
        } else if (!wasAchievedBefore) {
          shouldInsertFeed = true;
        }

        if (shouldInsertFeed) {
          // See src/lib/syncWater.ts:142 for the partial-index ON CONFLICT
          // discussion — same race-safety pattern. For activityType==='workout',
          // no partial unique index applies (manual workouts have NULL
          // healthkit_uuid), so 23505 cannot fire — the catch is a defensive
          // no-op for that path.
          const { data: insertedRows, error: feedError } = await supabase
            .from("activity_feed")
            .insert({
              pack_id: pack.id,
              user_id: userId,
              activity_type: activityType,
              value,
              points_earned: pointsEarned,
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
            notifyPackMembers(userId, pack.id, {
              kind: "goal",
              activityType,
              pointsEarned,
            }).catch(() => {});
          }
        }
      }
    }
  } catch (err) {
    console.error("[logActivity] syncManualActivityToDailyScores error:", err);
  }
}
