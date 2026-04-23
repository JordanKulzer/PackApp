import AppleHealthKit, {
  HealthKitPermissions,
  HealthValue,
} from "react-native-health";
import { Platform } from "react-native";
import { supabase } from "./supabase";
import { POINTS, WORKOUT_MAX_DAILY, workoutPoints, getStreakMultiplier } from "./scoring";
import { computeStreakForRun } from "./computeStreak";
import { notifyPackMembers } from "./notifications";
import { detectAndSendThreatNotifications } from "./threatNotifications";
import { packToday, packTodayStartUTC } from "./packDates";
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

// Stable identifier for a single HK workout: startDate|endDate
export interface WorkoutSample {
  identifier: string;  // startDate|endDate — used for deduplication
  startDate: string;
  endDate: string;
  activityType: number | null;  // HKWorkoutActivityType numeric value (null if unavailable)
}

// Map of HKWorkoutActivityType integers to human-readable names
const HK_WORKOUT_TYPE_NAMES: Record<number, string> = {
  1: "American Football", 2: "Archery", 3: "Australian Football", 4: "Badminton",
  5: "Baseball", 6: "Basketball", 7: "Bowling", 8: "Boxing",
  9: "Climbing", 10: "Cricket", 11: "Cross Country Skiing", 12: "Cross Training",
  13: "Curling", 14: "Cycling", 16: "Elliptical", 17: "Equestrian Sports",
  18: "Fencing", 19: "Fishing", 20: "Functional Strength Training", 21: "Golf",
  22: "Gymnastics", 23: "Handball", 24: "Hiking", 25: "Hockey",
  26: "Hunting", 27: "Lacrosse", 28: "Martial Arts", 29: "Mind and Body",
  31: "Paddle Sports", 32: "Play", 33: "Preparation and Recovery", 34: "Racquetball",
  35: "Rowing", 36: "Rugby", 37: "Running", 38: "Sailing",
  39: "Skating Sports", 40: "Snow Sports", 41: "Soccer", 42: "Softball",
  43: "Squash", 44: "StairClimbing", 45: "Surfing Sports", 46: "Swimming",
  47: "Table Tennis", 48: "Tennis", 49: "Track and Field", 50: "Traditional Strength Training",
  51: "Volleyball", 52: "Walking", 53: "Water Fitness", 54: "Water Polo",
  55: "Water Sports", 56: "Wrestling", 57: "Yoga", 58: "Barre",
  59: "Core Training", 60: "Dance", 62: "Flexibility", 63: "High Intensity Interval Training",
  64: "Jump Rope", 65: "Kickboxing", 66: "Pilates", 68: "Stairs",
  69: "Step Training", 70: "Wheelchair Walk Pace", 71: "Wheelchair Run Pace",
  74: "Tai Chi", 75: "Mixed Cardio", 76: "Hand Cycling",
};

export function workoutTypeName(activityType: number | null): string {
  if (activityType === null || activityType === 3000) return "Workout"; // 3000 = other
  return HK_WORKOUT_TYPE_NAMES[activityType] ?? "Workout";
}

export async function getWorkoutSamples(since?: Date): Promise<WorkoutSample[]> {
  if (!nativeAvailable()) return [];
  try {
    const start = since ?? startOfToday();
    return await new Promise<WorkoutSample[]>((resolve) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (AppleHealthKit as any).getSamples(
        {
          startDate: start.toISOString(),
          endDate: new Date().toISOString(),
          type: "Workout",
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (error: string, results: any[]) => {
          if (error) {
            console.error("[HealthKit] getWorkoutSamples error:", error);
            resolve([]);
          } else {
            resolve(
              (results ?? []).map((r) => ({
                identifier: `${r.startDate}|${r.endDate}`,
                startDate: r.startDate,
                endDate: r.endDate,
                activityType: r.workoutActivityType ?? null,
              })),
            );
          }
        },
      );
    });
  } catch (err) {
    console.error("[HealthKit] getWorkoutSamples exception:", err);
    return [];
  }
}

export async function getTodayWorkouts(): Promise<number> {
  const samples = await getWorkoutSamples(startOfToday());
  return samples.length;
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

  // Step 2: Compute today's date string in the pack's timezone
  const today = packToday(pack.timezone ?? "UTC");

  // Step 2a: Read prior row for delta computation and threat delta
  const { data: priorRow } = await supabase
    .from("daily_scores")
    .select(
      "total_points, steps_count, calories_count, workout_count, hk_steps_count, hk_calories_count, hk_workout_count",
    )
    .eq("run_id", runId)
    .eq("user_id", userId)
    .eq("score_date", today)
    .maybeSingle();

  const oldTodayScore = priorRow?.total_points ?? 0;
  const prevStepsCount = priorRow?.steps_count ?? 0;
  const prevCaloriesCount = priorRow?.calories_count ?? 0;
  const prevWorkoutCount = priorRow?.workout_count ?? 0;
  const prevHkSteps = priorRow?.hk_steps_count ?? 0;
  const prevHkCalories = priorRow?.hk_calories_count ?? 0;
  const prevHkWorkouts = priorRow?.hk_workout_count ?? 0;

  // Step 2b: HealthKit values are absolute snapshots. Add only the new increment
  // since last sync so manual entries in steps_count / workout_count are preserved.
  const cappedWorkouts = Math.min(workouts, WORKOUT_MAX_DAILY);
  const newHkSteps = Math.round(steps);
  const newHkCalories = Math.round(calories);
  const newHkWorkouts = cappedWorkouts;

  const hkStepsDelta = Math.max(0, newHkSteps - prevHkSteps);
  const hkCaloriesDelta = Math.max(0, newHkCalories - prevHkCalories);
  const hkWorkoutsDelta = Math.max(0, newHkWorkouts - prevHkWorkouts);

  const newStepsCount = prevStepsCount + hkStepsDelta;
  const newCaloriesCount = prevCaloriesCount + hkCaloriesDelta;
  const newWorkoutCount = Math.min(prevWorkoutCount + hkWorkoutsDelta, WORKOUT_MAX_DAILY);

  // Step 3: Determine achievements using combined (manual + HK) totals
  const steps_achieved = pack.steps_enabled && newStepsCount >= pack.step_target;
  const workout_achieved = pack.workouts_enabled && newWorkoutCount >= 1;
  const calories_achieved = pack.calories_enabled && newCaloriesCount >= pack.calorie_target;
  const water_achieved = pack.water_enabled && waterOz >= pack.water_target_oz;

  // Step 4: Base points (before multiplier)
  const basePoints =
    (steps_achieved ? POINTS.steps : 0) +
    (pack.workouts_enabled ? workoutPoints(newWorkoutCount) : 0) +
    (calories_achieved ? POINTS.calories : 0) +
    (water_achieved ? POINTS.water : 0);

  // Step 5: Calculate streak via shared utility
  const anyToday =
    steps_achieved || workout_achieved || calories_achieved || water_achieved;
  const packTz = pack.timezone ?? "UTC";
  const streakDays = await computeStreakForRun(userId, runId, today, anyToday, packTz);

  // Step 6: Apply multiplier
  const streakMultiplier = getStreakMultiplier(streakDays);
  const total_points = Math.round(basePoints * streakMultiplier);

  // Step 7: Upsert to daily_scores
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
      steps_count: newStepsCount,
      calories_count: newCaloriesCount,
      water_oz_count: Math.round(waterOz),
      workout_count: newWorkoutCount,
      hk_steps_count: newHkSteps,
      hk_calories_count: newHkCalories,
      hk_workout_count: newHkWorkouts,
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
  // Steps / calories / water — one row per type per day (idempotent upsert)
  const idempotentRows: Array<{
    user_id: string;
    activity_type: string;
    points_earned: number;
    activity_date: string;
    healthkit_data: Record<string, number>;
  }> = [];

  if (steps_achieved) {
    idempotentRows.push({
      user_id: userId,
      activity_type: "steps",
      points_earned: Math.round(POINTS.steps * streakMultiplier),
      activity_date: today,
      healthkit_data: { raw_value: Math.round(steps) },
    });
  }
  if (calories_achieved) {
    idempotentRows.push({
      user_id: userId,
      activity_type: "calories",
      points_earned: Math.round(POINTS.calories * streakMultiplier),
      activity_date: today,
      healthkit_data: { raw_value: Math.round(calories) },
    });
  }
  if (water_achieved) {
    idempotentRows.push({
      user_id: userId,
      activity_type: "water",
      points_earned: Math.round(POINTS.water * streakMultiplier),
      activity_date: today,
      healthkit_data: { raw_value: Math.round(waterOz) },
    });
  }

  for (const row of idempotentRows) {
    const { error: logError } = await supabase.from("activity_logs").insert(row);
    if (logError && logError.code !== "23505") {
      console.error("[HealthKit Sync] activity_logs insert error:", logError);
    }
  }

  // Workouts — one row per credited workout (up to WORKOUT_MAX_DAILY).
  // syncWorkoutsToSupabase handles deduplication via synced_workout_ids;
  // this path just ensures the count in activity_logs stays in sync with
  // what daily_scores records after the aggregate sync.
  if (workout_achieved) {
    const { data: existingWorkoutLog } = await supabase
      .from("activity_logs")
      .select("id, healthkit_data")
      .eq("user_id", userId)
      .eq("activity_type", "workout")
      .eq("activity_date", today)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!existingWorkoutLog) {
      // First workout row for today — insert once; syncWorkoutsToSupabase adds the rest
      await supabase.from("activity_logs").insert({
        user_id: userId,
        activity_type: "workout",
        points_earned: Math.round(POINTS.workout * streakMultiplier),
        activity_date: today,
        healthkit_data: { raw_value: cappedWorkouts, synced_workout_ids: [] },
      });
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

  const todayStart = packTodayStartUTC(pack.timezone ?? "UTC");

  const rawValues: Record<string, number> = {
    steps: newStepsCount,
    workout: newWorkoutCount,
    calories: newCaloriesCount,
    water: Math.round(waterOz),
  };

  for (const { type, points } of achievedTypes) {
    if (type === "workout") {
      // Allow up to WORKOUT_MAX_DAILY workout feed entries per day — one per workout.
      const { count: existingWorkoutCount } = await supabase
        .from("activity_feed")
        .select("id", { count: "exact", head: true })
        .eq("pack_id", packId)
        .eq("user_id", userId)
        .eq("activity_type", "workout")
        .gte("created_at", todayStart.toISOString());
      const workoutsToCredit = cappedWorkouts - (existingWorkoutCount ?? 0);
      for (let i = 0; i < workoutsToCredit; i++) {
        const { error: feedError } = await supabase.from("activity_feed").insert({
          pack_id: packId,
          user_id: userId,
          activity_type: "workout",
          value: cappedWorkouts,
          points_earned: Math.round(POINTS.workout * streakMultiplier),
          entry_method: "healthkit",
        });
        if (!feedError) {
          notifyPackMembers(userId, packId, {
            kind: "goal",
            activityType: "workout",
            pointsEarned: Math.round(POINTS.workout * streakMultiplier),
          }).catch(() => {});
        }
      }
    } else {
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
            activityType: type as "steps" | "calories" | "water",
            pointsEarned: points,
          }).catch(() => {});
        }
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
    hkSteps: newHkSteps,
    hkCalories: newHkCalories,
    hkWorkouts: newHkWorkouts,
    hkStepsDelta,
    hkCaloriesDelta,
    hkWorkoutsDelta,
    totalSteps: newStepsCount,
    totalCalories: newCaloriesCount,
    totalWorkouts: newWorkoutCount,
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

// ─────────────────────────────────────────────────────────────────────────────
// Per-workout deduplication sync
//
// Queries HealthKit for workouts from the past 2 days, credits any that haven't
// been synced yet (identified by startDate|endDate stored in activity_logs
// healthkit_data.synced_workout_ids), up to WORKOUT_MAX_DAILY per day per pack.
//
// SQL migration required before this runs correctly:
//   ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS synced_workout_ids jsonb DEFAULT '[]'::jsonb;
// ─────────────────────────────────────────────────────────────────────────────

export async function syncWorkoutsToSupabase(userId: string): Promise<void> {
  if (!nativeAvailable()) return;

  // Query workouts from 2 days ago to catch any retroactive data
  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  twoDaysAgo.setHours(0, 0, 0, 0);

  const samples = await getWorkoutSamples(twoDaysAgo);
  if (samples.length === 0) return;

  // Group all samples by UTC date for initial bucketing — per-pack filtering
  // below re-checks using pack timezone once we know which pack we're in.
  const byDate = new Map<string, WorkoutSample[]>();
  for (const s of samples) {
    const date = s.endDate.split("T")[0];
    const bucket = byDate.get(date) ?? [];
    bucket.push(s);
    byDate.set(date, bucket);
  }

  if (byDate.size === 0) return;

  // Get all active packs for this user
  const { data: memberships } = await supabase
    .from("pack_members")
    .select("pack_id")
    .eq("user_id", userId)
    .eq("is_active", true);

  if (!memberships?.length) return;

  for (const { pack_id } of memberships) {
    const { data: pack } = await supabase
      .from("packs")
      .select("*")
      .eq("id", pack_id)
      .maybeSingle();
    if (!pack?.workouts_enabled) continue;

    const { data: run } = await supabase
      .from("runs")
      .select("id, start_date, end_date")
      .eq("pack_id", pack_id)
      .eq("status", "active")
      .maybeSingle();
    if (!run) continue;

    // Only credit today and yesterday in this pack's timezone
    const packTz: string = pack.timezone ?? "UTC";
    const todayStr = packToday(packTz);
    const yesterdayStr = (() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: packTz, year: "numeric", month: "2-digit", day: "2-digit",
      }).format(d);
    })();

    for (const [date, daySamples] of byDate.entries()) {
      if (date !== todayStr && date !== yesterdayStr) continue;
      // Read existing activity_logs row to get already-synced workout IDs
      const { data: logRow } = await supabase
        .from("activity_logs")
        .select("id, healthkit_data")
        .eq("user_id", userId)
        .eq("activity_type", "workout")
        .eq("activity_date", date)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existing_hk = (logRow?.healthkit_data as any) ?? {};
      const syncedIds: string[] = existing_hk.synced_workout_ids ?? [];

      const newSamples = daySamples.filter((s) => !syncedIds.includes(s.identifier));
      if (newSamples.length === 0) continue;

      // Get current workout_count for this date/run
      const { data: scoreRow } = await supabase
        .from("daily_scores")
        .select("workout_count, total_points, steps_achieved, calories_achieved, water_achieved, streak_multiplier, hk_workout_count")
        .eq("run_id", run.id)
        .eq("user_id", userId)
        .eq("score_date", date)
        .maybeSingle();

      const currentCount = scoreRow?.workout_count ?? 0;
      const slotsRemaining = WORKOUT_MAX_DAILY - currentCount;
      if (slotsRemaining <= 0) continue;

      const toCredit = newSamples.slice(0, slotsRemaining);
      const newCount = currentCount + toCredit.length;
      const newSyncedIds = [...syncedIds, ...toCredit.map((s) => s.identifier)];

      const streakMultiplier = scoreRow?.streak_multiplier ?? 1;
      const pointsDelta = toCredit.length * Math.round(POINTS.workout * streakMultiplier);
      const newTotalPoints = (scoreRow?.total_points ?? 0) + pointsDelta;

      // Upsert daily_scores with new workout count and updated total
      await supabase.from("daily_scores").upsert(
        {
          run_id: run.id,
          user_id: userId,
          score_date: date,
          workout_count: newCount,
          hk_workout_count: (scoreRow?.hk_workout_count ?? 0) + toCredit.length,
          workout_achieved: newCount >= 1,
          total_points: newTotalPoints,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "run_id,user_id,score_date" },
      );

      // Update activity_logs — write synced_workout_ids back to the tracking row.
      // The row was already read as logRow above; update it if it exists, insert if not.
      if (logRow) {
        await supabase
          .from("activity_logs")
          .update({
            healthkit_data: { raw_value: newCount, synced_workout_ids: newSyncedIds },
            points_earned: Math.round(POINTS.workout * streakMultiplier),
          })
          .eq("id", logRow.id);
      } else {
        await supabase.from("activity_logs").insert({
          user_id: userId,
          activity_type: "workout",
          points_earned: Math.round(POINTS.workout * streakMultiplier),
          activity_date: date,
          healthkit_data: { raw_value: newCount, synced_workout_ids: newSyncedIds },
        });
      }

      // Insert activity_feed entries for each newly credited workout
      const todayStart = new Date(date + "T00:00:00");
      const dayEnd = new Date(date + "T23:59:59");
      const { count: existingFeedCount } = await supabase
        .from("activity_feed")
        .select("id", { count: "exact", head: true })
        .eq("pack_id", pack_id)
        .eq("user_id", userId)
        .eq("activity_type", "workout")
        .gte("created_at", todayStart.toISOString())
        .lte("created_at", dayEnd.toISOString());

      const feedSlotsRemaining = WORKOUT_MAX_DAILY - (existingFeedCount ?? 0);
      const feedToInsert = Math.min(toCredit.length, feedSlotsRemaining);
      for (let i = 0; i < feedToInsert; i++) {
        await supabase.from("activity_feed").insert({
          pack_id,
          user_id: userId,
          activity_type: "workout",
          value: newCount,
          points_earned: Math.round(POINTS.workout * streakMultiplier),
          entry_method: "healthkit",
        });
      }

      console.log(`[WorkoutSync] credited ${toCredit.length} new workout(s) for ${date} in pack ${pack_id}`);
    }
  }
}
