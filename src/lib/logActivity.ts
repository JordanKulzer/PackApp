// Shared sync logic for manual activity logging (steps, workout, calories).
// Water has its own path via syncWaterToDailyScores (water_logs → daily_scores).
// These activities upsert daily_scores directly since there is no separate log table.

import { supabase } from "./supabase";
import { POINTS, getStreakMultiplier } from "./scoring";
import { computeStreakForRun } from "./computeStreak";
import { notifyPackMembers } from "./notifications";
import { detectAndSendThreatNotifications } from "./threatNotifications";

export type ManualActivityType = "steps" | "workout" | "calories";

// Syncs a manual activity to daily_scores for every active pack the user belongs to.
//   delta: amount to ADD for steps/calories; pass 1 for workout (binary achieved)
//   today: YYYY-MM-DD
//
// Points rules (matches HealthKit sync behavior):
//   - goal threshold crossed → award points once per day
//   - overflow above threshold is stored but no extra points
//   - streak multiplier already stored in daily_scores.streak_multiplier
export async function syncManualActivityToDailyScores(
  userId: string,
  activityType: ManualActivityType,
  delta: number,
  today: string,
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
          "id, steps_enabled, workouts_enabled, calories_enabled, step_target, calorie_target",
        )
        .eq("id", pack_id)
        .maybeSingle();

      if (!pack) continue;

      const enabled =
        (activityType === "steps" && pack.steps_enabled) ||
        (activityType === "workout" && pack.workouts_enabled) ||
        (activityType === "calories" && pack.calories_enabled);

      if (!enabled) continue;

      const { data: run } = await supabase
        .from("runs")
        .select("id")
        .eq("pack_id", pack.id)
        .eq("status", "active")
        .maybeSingle();

      if (!run) continue;

      // Read current row to preserve other goal counts and achieved flags
      const { data: existing } = await supabase
        .from("daily_scores")
        .select(
          "total_points, steps_count, calories_count, workout_count, steps_achieved, workout_achieved, calories_achieved, water_achieved",
        )
        .eq("run_id", run.id)
        .eq("user_id", userId)
        .eq("score_date", today)
        .maybeSingle();

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
        newWorkoutCount = 1;
        workout_achieved = true;
      } else {
        newCaloriesCount = (existing?.calories_count ?? 0) + delta;
        calories_achieved = newCaloriesCount >= (pack.calorie_target ?? Infinity);
      }

      const anyAchieved = steps_achieved || workout_achieved || calories_achieved || water_achieved;
      const streakDays = await computeStreakForRun(userId, run.id, today, anyAchieved);
      const multiplier = getStreakMultiplier(streakDays);

      const newTotalPoints = Math.round(
        ((steps_achieved   ? POINTS.steps   : 0) +
         (workout_achieved ? POINTS.workout  : 0) +
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

      if (nowAchieved && !wasAchievedBefore) {
        const basePoints =
          activityType === "steps"   ? POINTS.steps :
          activityType === "workout" ? POINTS.workout :
                                       POINTS.calories;
        const pointsEarned = Math.round(basePoints * multiplier);
        const value =
          activityType === "steps"   ? newStepsCount :
          activityType === "workout" ? newWorkoutCount :
                                       newCaloriesCount;

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const { data: existingFeed } = await supabase
          .from("activity_feed")
          .select("id")
          .eq("pack_id", pack.id)
          .eq("user_id", userId)
          .eq("activity_type", activityType)
          .gte("created_at", todayStart.toISOString())
          .maybeSingle();

        if (!existingFeed) {
          const { error: feedError } = await supabase.from("activity_feed").insert({
            pack_id: pack.id,
            user_id: userId,
            activity_type: activityType,
            value,
            points_earned: pointsEarned,
            entry_method: "manual",
          });
          if (!feedError) {
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
