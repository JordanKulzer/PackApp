import AppleHealthKit, {
  HealthKitPermissions,
  HealthValue,
} from "react-native-health";
import { Platform } from "react-native";
import { supabase } from "./supabase";
import { POINTS, getStreakMultiplier } from "./scoring";
import { computeStreakForRun } from "./computeStreak";
import { notifyPackMembers } from "./notifications";
import { detectAndSendThreatNotifications } from "./threatNotifications";
import type { Pack } from "../types/database";

// ─────────────────────────────────────────────────────────────────────────────
// Native availability guard
// react-native-health requires a custom dev build — it is NOT available in
// Expo Go even on a real iOS device.  Checking Platform.OS alone is not enough;
// we also verify that the native module is actually registered.
// ─────────────────────────────────────────────────────────────────────────────

function nativeAvailable(): boolean {
  return (
    Platform.OS === "ios" &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (AppleHealthKit as any)?.initHealthKit === "function"
  );
}

export function isHealthKitAvailable(): boolean {
  return nativeAvailable();
}

// ─────────────────────────────────────────────────────────────────────────────
// Permissions
// ─────────────────────────────────────────────────────────────────────────────

// Accessed lazily so that accessing .Constants doesn't throw when the native
// module is absent (Expo Go).
function getPermissions(): HealthKitPermissions {
  return {
    permissions: {
      read: [
        AppleHealthKit.Constants.Permissions.StepCount,
        AppleHealthKit.Constants.Permissions.ActiveEnergyBurned,
        AppleHealthKit.Constants.Permissions.Workout,
      ],
      write: [AppleHealthKit.Constants.Permissions.Water],
    },
  };
}

export async function requestHealthKitPermissions(): Promise<boolean> {
  if (!nativeAvailable()) {
    console.warn(
      "[HealthKit] Native module not available. " +
        "A custom dev build (npx expo run:ios) is required for HealthKit.",
    );
    return false;
  }
  return new Promise<boolean>((resolve) => {
    AppleHealthKit.initHealthKit(getPermissions(), (error) => {
      if (error) {
        console.error("[HealthKit] initHealthKit error:", error);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────
// Individual HealthKit readers
// ─────────────────────────────────────────────────────────────────────────────

export async function getTodaySteps(): Promise<number> {
  if (!nativeAvailable()) return 0;
  try {
    return await new Promise<number>((resolve) => {
      AppleHealthKit.getStepCount(
        { date: startOfToday().toISOString(), includeManuallyAdded: false },
        (error: string, result: HealthValue) => {
          if (error) {
            console.error("[HealthKit] getStepCount error:", error);
            resolve(0);
          } else {
            resolve(Math.round(result.value));
          }
        },
      );
    });
  } catch (err) {
    console.error("[HealthKit] getTodaySteps exception:", err);
    return 0;
  }
}

export async function getTodayActiveCalories(): Promise<number> {
  if (!nativeAvailable()) return 0;
  try {
    return await new Promise<number>((resolve) => {
      AppleHealthKit.getActiveEnergyBurned(
        {
          startDate: startOfToday().toISOString(),
          endDate: new Date().toISOString(),
        },
        (error: string, results: HealthValue[]) => {
          if (error) {
            console.error("[HealthKit] getActiveEnergyBurned error:", error);
            resolve(0);
          } else {
            const total = (results ?? []).reduce((sum, r) => sum + r.value, 0);
            resolve(Math.round(total));
          }
        },
      );
    });
  } catch (err) {
    console.error("[HealthKit] getTodayActiveCalories exception:", err);
    return 0;
  }
}

export async function getTodayWorkouts(): Promise<number> {
  if (!nativeAvailable()) return 0;
  try {
    return await new Promise<number>((resolve) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (AppleHealthKit as any).getSamples(
        {
          startDate: startOfToday().toISOString(),
          endDate: new Date().toISOString(),
          type: "Workout",
        },
        (error: string, results: HealthValue[]) => {
          if (error) {
            console.error("[HealthKit] getSamples (Workout) error:", error);
            resolve(0);
          } else {
            resolve((results ?? []).length);
          }
        },
      );
    });
  } catch (err) {
    console.error("[HealthKit] getTodayWorkouts exception:", err);
    return 0;
  }
}

export async function getTodayWaterOz(): Promise<number> {
  if (!nativeAvailable()) return 0;
  try {
    return await new Promise<number>((resolve) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (AppleHealthKit as any).getWaterSamples(
        {
          startDate: startOfToday().toISOString(),
          endDate: new Date().toISOString(),
          unit: "fl_oz",
        },
        (error: string, results: HealthValue[]) => {
          if (error) {
            console.error("[HealthKit] getWaterSamples error:", error);
            resolve(0);
          } else {
            const total = (results ?? []).reduce((sum, r) => sum + r.value, 0);
            resolve(Math.round(total));
          }
        },
      );
    });
  } catch (err) {
    console.error("[HealthKit] getTodayWaterOz exception:", err);
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Write water to HealthKit (used by water screen)
// ─────────────────────────────────────────────────────────────────────────────

export function logWaterToHealthKit(amountOz: number): Promise<void> {
  if (!nativeAvailable()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    AppleHealthKit.saveWater(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        value: amountOz,
        unit: "floz" as any,
        startDate: new Date().toISOString(),
      },
      (error: string) => {
        if (error) reject(new Error(error));
        else resolve();
      },
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main sync function
// ─────────────────────────────────────────────────────────────────────────────

export async function syncHealthDataToSupabase(
  userId: string,
  packId: string,
  runId: string,
  pack: Pack,
): Promise<void> {
  if (!nativeAvailable()) return;

  // Step 1: Fetch all raw values in parallel
  const [steps, calories, workouts, waterOz] = await Promise.all([
    getTodaySteps(),
    getTodayActiveCalories(),
    getTodayWorkouts(),
    getTodayWaterOz(),
  ]);

  // Step 2: Determine achievements
  const steps_achieved = pack.steps_enabled && steps >= pack.step_target;
  const workout_achieved = pack.workouts_enabled && workouts >= 1;
  const calories_achieved =
    pack.calories_enabled && calories >= pack.calorie_target;
  const water_achieved = pack.water_enabled && waterOz >= pack.water_target_oz;

  // Step 3: Base points (before multiplier)
  const basePoints =
    (steps_achieved ? POINTS.steps : 0) +
    (workout_achieved ? POINTS.workout : 0) +
    (calories_achieved ? POINTS.calories : 0) +
    (water_achieved ? POINTS.water : 0);

  // Step 4: Calculate streak via shared utility
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const anyToday =
    steps_achieved || workout_achieved || calories_achieved || water_achieved;
  const streakDays = await computeStreakForRun(userId, runId, today, anyToday);

  // Step 5: Apply multiplier
  const streakMultiplier = getStreakMultiplier(streakDays);
  const total_points = Math.round(basePoints * streakMultiplier);

  // Step 5b: Snapshot existing today score before overwriting — needed for threat delta
  const { data: existingToday } = await supabase
    .from("daily_scores")
    .select("total_points")
    .eq("run_id", runId)
    .eq("user_id", userId)
    .eq("score_date", today)
    .maybeSingle();
  const oldTodayScore = existingToday?.total_points ?? 0;

  // Step 6: Upsert to daily_scores
  const { error: upsertError } = await supabase.from("daily_scores").upsert(
    {
      run_id: runId,
      user_id: userId,
      score_date: today,
      total_points,
      streak_days: streakDays,
      streak_multiplier: streakMultiplier,
      steps_achieved,
      workout_achieved,
      calories_achieved,
      water_achieved,
      steps_count: Math.round(steps),
      calories_count: Math.round(calories),
      water_oz_count: Math.round(waterOz),
      workout_count: workouts,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "run_id,user_id,score_date" },
  );

  if (upsertError) {
    console.error("[HealthKit Sync] Supabase upsert error:", upsertError);
    throw upsertError;
  }

  const todayDelta = total_points - oldTodayScore;
  if (todayDelta > 0) {
    detectAndSendThreatNotifications(userId, packId, runId, todayDelta).catch(() => {});
  }

  // Step 7: Log individual achieved activities to activity_logs
  const activityRows: Array<{
    user_id: string;
    activity_type: string;
    points_earned: number;
    activity_date: string;
    healthkit_data: Record<string, number>;
  }> = [];

  if (steps_achieved) {
    activityRows.push({
      user_id: userId,
      activity_type: "steps",
      points_earned: Math.round(POINTS.steps * streakMultiplier),
      activity_date: today,
      healthkit_data: { raw_value: Math.round(steps) },
    });
  }
  if (workout_achieved) {
    activityRows.push({
      user_id: userId,
      activity_type: "workout",
      points_earned: Math.round(POINTS.workout * streakMultiplier),
      activity_date: today,
      healthkit_data: { raw_value: workouts },
    });
  }
  if (calories_achieved) {
    activityRows.push({
      user_id: userId,
      activity_type: "calories",
      points_earned: Math.round(POINTS.calories * streakMultiplier),
      activity_date: today,
      healthkit_data: { raw_value: Math.round(calories) },
    });
  }
  if (water_achieved) {
    activityRows.push({
      user_id: userId,
      activity_type: "water",
      points_earned: Math.round(POINTS.water * streakMultiplier),
      activity_date: today,
      healthkit_data: { raw_value: Math.round(waterOz) },
    });
  }

  if (activityRows.length > 0) {
    const { error: logError } = await supabase
      .from("activity_logs")
      .upsert(activityRows, {
        onConflict: "user_id,activity_type,activity_date",
      });
    if (logError) {
      console.error("[HealthKit Sync] activity_logs upsert error:", logError);
    }
  }

  // Insert activity_feed events for each newly-achieved goal.
  // The duplicate guard (maybeSingle check) ensures we only fire once per
  // goal per day even when syncHealthDataToSupabase is called repeatedly.
  const achievedTypes: Array<{ type: string; points: number }> = [];
  if (steps_achieved)    achievedTypes.push({ type: "steps",    points: Math.round(POINTS.steps    * streakMultiplier) });
  if (workout_achieved)  achievedTypes.push({ type: "workout",  points: Math.round(POINTS.workout  * streakMultiplier) });
  if (calories_achieved) achievedTypes.push({ type: "calories", points: Math.round(POINTS.calories * streakMultiplier) });
  if (water_achieved)    achievedTypes.push({ type: "water",    points: Math.round(POINTS.water    * streakMultiplier) });

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const rawValues: Record<string, number> = {
    steps: Math.round(steps),
    workout: workouts,
    calories: Math.round(calories),
    water: Math.round(waterOz),
  };

  for (const { type, points } of achievedTypes) {
    const { data: existingFeed } = await supabase
      .from("activity_feed")
      .select("id")
      .eq("pack_id", packId)
      .eq("user_id", userId)
      .eq("activity_type", type)
      .gte("created_at", todayStart.toISOString())
      .maybeSingle();

    if (!existingFeed) {
      const { error: feedError } = await supabase.from("activity_feed").insert({
        pack_id: packId,
        user_id: userId,
        activity_type: type,
        value: rawValues[type] ?? 0,
        points_earned: points,
        entry_method: "healthkit",
      });
      if (!feedError) {
        notifyPackMembers(userId, packId, {
          kind: "goal",
          activityType: type as "steps" | "workout" | "calories" | "water",
          pointsEarned: points,
        }).catch(() => {});
      }
    }
  }

  // All-goals event — fires once when every enabled goal is hit on the same day.
  // Requires at least 2 enabled goals so it carries meaningful signal.
  const enabledGoalCount = [
    pack.steps_enabled,
    pack.workouts_enabled,
    pack.calories_enabled,
    pack.water_enabled,
  ].filter(Boolean).length;

  if (achievedTypes.length === enabledGoalCount && enabledGoalCount >= 2) {
    const { data: existingAllGoals } = await supabase
      .from("activity_feed")
      .select("id")
      .eq("pack_id", packId)
      .eq("user_id", userId)
      .eq("activity_type", "all_goals")
      .gte("created_at", todayStart.toISOString())
      .maybeSingle();

    if (!existingAllGoals) {
      const { error: allGoalsError } = await supabase.from("activity_feed").insert({
        pack_id: packId,
        user_id: userId,
        activity_type: "all_goals",
        value: enabledGoalCount,
        points_earned: total_points,
        entry_method: "healthkit",
      });
      if (!allGoalsError) {
        notifyPackMembers(userId, packId, {
          kind: "all_goals",
          totalPoints: total_points,
        }).catch(() => {});
      }
    }
  }

  console.log("[HealthKit Sync] Success:", {
    packId,
    steps,
    calories,
    workouts,
    waterOz,
    steps_achieved,
    workout_achieved,
    calories_achieved,
    water_achieved,
    total_points,
    streakDays,
    streakMultiplier,
  });
}
