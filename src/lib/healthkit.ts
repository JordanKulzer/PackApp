import {
  requestAuthorization,
  queryStatisticsForQuantity,
  queryWorkoutSamples,
  saveQuantitySample,
  getRequestStatusForAuthorization,
  AuthorizationRequestStatus,
} from "@kingstinct/react-native-healthkit";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { POINTS, WORKOUT_MAX_DAILY, workoutPoints, getStreakMultiplier } from "./scoring";
import { computeStreakForRun } from "./computeStreak";
import { notifyPackMembers } from "./notifications";
import { detectAndSendThreatNotifications } from "./threatNotifications";
import { packToday, packDateRangeUTC } from "./packDates";
import { getCategoryFromHKType } from "./activityCategoryMap";
import { analytics } from "./analytics";
import type { Pack } from "../types/database";

// ─────────────────────────────────────────────────────────────────────────────
// Native availability guard
// kingstinct/react-native-healthkit is a TurboModule via react-native-nitro-modules.
// It requires a custom dev build — not available in Expo Go.
// ─────────────────────────────────────────────────────────────────────────────

function nativeAvailable(): boolean {
  return Platform.OS === "ios" && typeof requestAuthorization === "function";
}

export function isHealthKitAvailable(): boolean {
  return nativeAvailable();
}

// ─────────────────────────────────────────────────────────────────────────────
// Permissions
// ─────────────────────────────────────────────────────────────────────────────

const READ_PERMS = [
  "HKQuantityTypeIdentifierStepCount",
  "HKQuantityTypeIdentifierActiveEnergyBurned",
  "HKQuantityTypeIdentifierDietaryWater",
  "HKWorkoutTypeIdentifier",
] as const;

const WRITE_PERMS = ["HKQuantityTypeIdentifierDietaryWater"] as const;

// Types we register for iOS HealthKit background delivery. Water is omitted
// because it's manually logged inside the app — the source of truth lives
// in our DB, not in HealthKit. Keeping this list narrow keeps wake budget
// focused on the metrics that can silently break a streak.
//
// Consumed by app/_layout.tsx — pass to configureBackgroundTypes (writes
// to UserDefaults so the AppDelegate can re-register observers on cold
// launch) and one subscribeToChanges call per type (the JS-side handler
// that fires when the bridge is alive).
export const BACKGROUND_TYPES = [
  "HKQuantityTypeIdentifierStepCount",
  "HKQuantityTypeIdentifierActiveEnergyBurned",
  "HKWorkoutTypeIdentifier",
] as const;

// Throttle key + window for syncHealthDataForUser. The cross-wake gate (see
// the two-gate comment block above syncHealthDataForUser for the full design).
//
// Scope note: this key is global, not per-user. Fine for single-account use.
// If multi-account / fast account-switch ever lands, namespace as
// `pack:healthkit:lastSyncedAt:${userId}` — otherwise switching accounts
// within the throttle window would silently no-op the new user's first sync.
const LAST_SYNC_KEY = "pack:healthkit:lastSyncedAt";
const SYNC_THROTTLE_MS = 60_000;

// Burst-coalesce gate (see two-gate comment block above syncHealthDataForUser).
// Module-level so all call sites — observer callbacks in app/_layout.tsx, the
// foreground hook in useHealthKit.ts — share the same in-flight state.
let inFlightSync = false;
let lastBurstTs = 0;
const COALESCE_WINDOW_MS = 500;

export async function requestHealthKitPermissions(): Promise<boolean> {
  if (!nativeAvailable()) {
    console.warn(
      "[HealthKit] Native module not available. " +
        "A custom dev build (npx expo run:ios) is required for HealthKit.",
    );
    return false;
  }
  try {
    await requestAuthorization({ toRead: READ_PERMS, toShare: WRITE_PERMS });
    return true;
  } catch (err) {
    console.error("[HealthKit] requestAuthorization error:", err);
    return false;
  }
}

// Queries iOS for actual authorization state. Returns true only when iOS
// reports `unnecessary` (every requested type has been prompted at least
// once). Apple's privacy stance means we cannot distinguish "granted" from
// "denied" for read-only types, so this matches our existing semantics:
// "the user has been through the prompt for this set of types."
export async function getHealthKitAuthStatus(): Promise<boolean> {
  if (!nativeAvailable()) return false;
  try {
    const status = await getRequestStatusForAuthorization({
      toRead: READ_PERMS,
      toShare: WRITE_PERMS,
    });
    return status === AuthorizationRequestStatus.unnecessary;
  } catch (err) {
    console.error("[HealthKit] getRequestStatusForAuthorization error:", err);
    return false;
  }
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
//
// Range-based readers are the source of truth; the today-named helpers below
// are thin wrappers preserved so existing callers don't churn. Multi-day
// backfill (Pass 6.5b) drives all reads through the range variants.
// ─────────────────────────────────────────────────────────────────────────────

export async function getStepsForRange(start: Date, end: Date): Promise<number> {
  if (!nativeAvailable()) return 0;
  try {
    const result = await queryStatisticsForQuantity(
      "HKQuantityTypeIdentifierStepCount",
      ["cumulativeSum"],
      { filter: { date: { startDate: start, endDate: end } } },
    );
    return Math.round(result.sumQuantity?.quantity ?? 0);
  } catch (err) {
    console.error("[HealthKit] getStepsForRange error:", err);
    return 0;
  }
}

export async function getActiveCaloriesForRange(start: Date, end: Date): Promise<number> {
  if (!nativeAvailable()) return 0;
  try {
    const result = await queryStatisticsForQuantity(
      "HKQuantityTypeIdentifierActiveEnergyBurned",
      ["cumulativeSum"],
      {
        filter: { date: { startDate: start, endDate: end } },
        unit: "kcal",
      },
    );
    return Math.round(result.sumQuantity?.quantity ?? 0);
  } catch (err) {
    console.error("[HealthKit] getActiveCaloriesForRange error:", err);
    return 0;
  }
}

export async function getTodaySteps(): Promise<number> {
  return getStepsForRange(startOfToday(), new Date());
}

export async function getTodayActiveCalories(): Promise<number> {
  return getActiveCaloriesForRange(startOfToday(), new Date());
}

// Workout sample — identifier is the real HealthKit sample UUID, used for
// per-sample dedup in syncWorkoutsToSupabase via the partial unique index
// idx_activity_feed_no_dup_hk_workouts on (user_id, healthkit_uuid).
export interface WorkoutSample {
  identifier: string; // HealthKit sample.uuid
  startDate: string;  // ISO
  endDate: string;    // ISO
  activityType: number | null; // HKWorkoutActivityType numeric value
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

export async function getWorkoutSamples(
  since?: Date,
  until?: Date,
): Promise<WorkoutSample[]> {
  if (!nativeAvailable()) return [];
  try {
    const start = since ?? startOfToday();
    const end = until ?? new Date();
    const samples = await queryWorkoutSamples({
      limit: -1,
      filter: {
        date: { startDate: start, endDate: end },
      },
    });
    return samples.map((s) => ({
      identifier: s.uuid,
      startDate: s.startDate.toISOString(),
      endDate: s.endDate.toISOString(),
      activityType: s.workoutActivityType ?? null,
    }));
  } catch (err) {
    console.error("[HealthKit] getWorkoutSamples error:", err);
    return [];
  }
}

export async function getTodayWorkouts(): Promise<number> {
  const samples = await getWorkoutSamples(startOfToday());
  return samples.length;
}

export async function getWaterOzForRange(start: Date, end: Date): Promise<number> {
  if (!nativeAvailable()) return 0;
  try {
    const result = await queryStatisticsForQuantity(
      "HKQuantityTypeIdentifierDietaryWater",
      ["cumulativeSum"],
      {
        filter: { date: { startDate: start, endDate: end } },
        unit: "fl_oz_us",
      },
    );
    return Math.round(result.sumQuantity?.quantity ?? 0);
  } catch (err) {
    console.error("[HealthKit] getWaterOzForRange error:", err);
    return 0;
  }
}

export async function getTodayWaterOz(): Promise<number> {
  return getWaterOzForRange(startOfToday(), new Date());
}

// ─────────────────────────────────────────────────────────────────────────────
// Write water to HealthKit (used by water screen)
// ─────────────────────────────────────────────────────────────────────────────

export async function logWaterToHealthKit(amountOz: number): Promise<void> {
  if (!nativeAvailable()) return;
  const now = new Date();
  await saveQuantitySample(
    "HKQuantityTypeIdentifierDietaryWater",
    "fl_oz_us",
    amountOz,
    now,
    now,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main sync function
//
// Default behavior unchanged: pass userId/packId/runId/pack and the function
// syncs "today" and emits the usual feed events / pushes / threat detection.
//
// Pass 6.5b adds two optional params for multi-day backfill:
//   • scoreDate — YYYY-MM-DD in pack timezone. Defaults to today-in-pack-tz.
//     The function reads HK for this day, upserts daily_scores under this
//     score_date, and computes streak relative to it.
//   • mode      — "today" | "backfill". Default "today" preserves all existing
//     behavior. "backfill" suppresses activity_feed inserts, push notifications,
//     and threat detection — see the in-function comment at the suppression
//     site for the UX rationale.
// ─────────────────────────────────────────────────────────────────────────────

export async function syncHealthDataToSupabase(
  userId: string,
  packId: string,
  runId: string,
  pack: Pack,
  scoreDate?: string,
  mode: "today" | "backfill" = "today",
): Promise<void> {
  if (!nativeAvailable()) return;

  const packTz = pack.timezone ?? "UTC";
  // Local name `today` is the score-date being processed (may be a backfill
  // day). Kept under this name to minimize churn through the rest of the
  // function — every downstream usage refers to "the date we're scoring."
  const today = scoreDate ?? packToday(packTz);
  const { start: rangeStart, end: rangeEnd } = packDateRangeUTC(today, packTz);

  // Step 1: Fetch all raw values in parallel — scoped to the target day's
  // bounds in pack-tz, so backfill reads pull the correct day's data even
  // across DST and timezone shifts.
  const [steps, calories, workouts, waterOz] = await Promise.all([
    getStepsForRange(rangeStart, rangeEnd),
    getActiveCaloriesForRange(rangeStart, rangeEnd),
    getWorkoutSamples(rangeStart, rangeEnd).then((s) => s.length),
    getWaterOzForRange(rangeStart, rangeEnd),
  ]);

  // Step 2a: Read prior row for delta computation, threat delta, and Pass 9
  // funnel transition detection (activity_logged + streak_milestone gate on
  // these "before" values).
  const { data: priorRow } = await supabase
    .from("daily_scores")
    .select(
      "total_points, steps_count, calories_count, workout_count, hk_steps_count, hk_calories_count, hk_workout_count, streak_days, steps_achieved, calories_achieved, workout_achieved, water_achieved",
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
  // Frozen "before" snapshot for Pass 9 transition gating. Read from priorRow
  // (fresh DB read), NEVER from in-memory variables that get mutated below.
  const prevStepsAchieved    = priorRow?.steps_achieved    ?? false;
  const prevCaloriesAchieved = priorRow?.calories_achieved ?? false;
  const prevWorkoutAchieved  = priorRow?.workout_achieved  ?? false;
  const prevWaterAchieved    = priorRow?.water_achieved    ?? false;
  const prevStreakDays       = priorRow?.streak_days       ?? 0;

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
  if (todayDelta > 0 && mode === "today") {
    detectAndSendThreatNotifications(userId, packId, runId, todayDelta).catch(() => {});
  }

  // ── Pass 9 funnel: activity_logged (B-style transition gating) + streak_milestone
  //
  // Fires only on newly-crossed achievement transitions (priorRow_X_achieved
  // was false, new value is true). Reads the "before" state from priorRow
  // (fresh DB read above), NEVER from in-memory state below the upsert.
  // mode === "backfill" suppresses both events — these are user-action funnel
  // signals, not historical data fills.
  if (mode === "today") {
    // is_first_ever shortcut: if priorRow had points, definitely not first.
    // Otherwise run a single COUNT to verify across all runs/days. The
    // post-upsert count includes the just-written row, so ≤1 means it's the
    // only achievement row this user has ever produced.
    let isFirstEver = false;
    if (oldTodayScore === 0 && total_points > 0) {
      const { count } = await supabase
        .from("daily_scores")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gt("total_points", 0);
      isFirstEver = (count ?? 0) <= 1;
    }

    const goalHitToday = steps_achieved || workout_achieved || calories_achieved || water_achieved;
    type TransitionedType = "steps" | "workout" | "calories" | "water";
    const transitions: Array<{ type: TransitionedType; pointsEarned: number }> = [];
    if (!prevStepsAchieved    && steps_achieved)    transitions.push({ type: "steps",    pointsEarned: Math.round(POINTS.steps    * streakMultiplier) });
    if (!prevCaloriesAchieved && calories_achieved) transitions.push({ type: "calories", pointsEarned: Math.round(POINTS.calories * streakMultiplier) });
    if (!prevWorkoutAchieved  && workout_achieved)  transitions.push({ type: "workout",  pointsEarned: Math.round(POINTS.workout  * streakMultiplier) });
    if (!prevWaterAchieved    && water_achieved)    transitions.push({ type: "water",    pointsEarned: Math.round(POINTS.water    * streakMultiplier) });

    for (const t of transitions) {
      analytics.activityLogged({
        activity_type: t.type,
        source: "healthkit",
        points_earned: t.pointsEarned,
        is_first_ever: isFirstEver,
        streak_days_after: streakDays,
        goal_hit_today: goalHitToday,
      });
    }

    // Streak milestone — only the highest crossed threshold fires per update.
    // Backfill jumps could cross multiple at once; firing the highest avoids
    // a 3-event burst when streak goes 0 → 30+.
    const STREAK_MILESTONES = [3, 7, 14, 30, 60, 90] as const;
    let crossed: 3 | 7 | 14 | 30 | 60 | 90 | null = null;
    let priorMilestone = 0;
    for (const m of STREAK_MILESTONES) {
      if (prevStreakDays >= m) priorMilestone = m;
      if (prevStreakDays < m && streakDays >= m) crossed = m;
    }
    if (crossed) {
      analytics.streakMilestone({
        milestone_days: crossed,
        pack_id: packId,
        prior_milestone_days: priorMilestone,
      });
    }
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

  // ── Activity feed + push notifications ─────────────────────────────────
  //
  // SUPPRESSION ON BACKFILL — UX RATIONALE, NOT A BUG.
  //
  // When mode === "backfill" we deliberately skip every activity_feed insert
  // and every notifyPackMembers call below. The daily_scores upsert above
  // already credited the streak (the primary user-visible outcome of
  // backfill). What we don't want is for past-day activity to surface as
  // just-happened events:
  //
  //   • Activity feed inserts would appear in pack chat as "Jordan hit
  //     steps goal" hours after the fact, looking like a live event.
  //   • Push notifications would tell the pack about a goal hit two days
  //     ago, which is noise and erodes notification trust.
  //   • Threat-detection pushes (suppressed earlier) would falsely warn
  //     about lead changes that are historical, not current.
  //
  // The streak benefit lands silently — exactly the right shape for
  // recovering missed activity without surfacing stale events.
  // ──────────────────────────────────────────────────────────────────────
  const achievedTypes: Array<{ type: string; points: number }> = [];
  if (steps_achieved)    achievedTypes.push({ type: "steps",    points: Math.round(POINTS.steps    * streakMultiplier) });
  if (workout_achieved)  achievedTypes.push({ type: "workout",  points: Math.round(POINTS.workout  * streakMultiplier) });
  if (calories_achieved) achievedTypes.push({ type: "calories", points: Math.round(POINTS.calories * streakMultiplier) });
  if (water_achieved)    achievedTypes.push({ type: "water",    points: Math.round(POINTS.water    * streakMultiplier) });

  const rawValues: Record<string, number> = {
    steps: newStepsCount,
    workout: newWorkoutCount,
    calories: newCaloriesCount,
    water: Math.round(waterOz),
  };

  if (mode === "today") {
    for (const { type, points } of achievedTypes) {
      // Workouts are owned by syncWorkoutsToSupabase, which tracks per-sample
      // HealthKit UUIDs and inserts one feed row per credited sample. Skipping
      // here avoids the redundant + race-prone count-based path that was the
      // source of the original duplicate emissions.
      if (type === "workout") continue;

      // See src/lib/syncWater.ts:142 for the partial-index ON CONFLICT
      // discussion — same race-safety pattern. INSERT + 23505 catch
      // preserves ignoreDuplicates: true semantics; the partial unique
      // index still enforces uniqueness on INSERT.
      const { data: insertedRows, error: feedError } = await supabase
        .from("activity_feed")
        .insert({
          pack_id: packId,
          user_id: userId,
          activity_type: type,
          value: rawValues[type] ?? 0,
          points_earned: points,
          entry_method: "healthkit",
          score_date: today,
        })
        .select("id");

      if (feedError) {
        if (feedError.code !== "23505") {
          console.error("[HealthKit Sync] activity_feed insert error:", feedError);
        }
      } else if (insertedRows && insertedRows.length > 0) {
        notifyPackMembers(userId, packId, {
          kind: "goal",
          activityType: type as "steps" | "calories" | "water",
          pointsEarned: points,
        }).catch(() => {});
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
      // See src/lib/syncWater.ts:142 for the partial-index ON CONFLICT
      // discussion — same race-safety pattern.
      const { data: insertedAllGoals, error: allGoalsError } = await supabase
        .from("activity_feed")
        .insert({
          pack_id: packId,
          user_id: userId,
          activity_type: "all_goals",
          value: enabledGoalCount,
          points_earned: total_points,
          entry_method: "healthkit",
          score_date: today,
        })
        .select("id");

      if (allGoalsError) {
        if (allGoalsError.code !== "23505") {
          console.error("[HealthKit Sync] all_goals insert error:", allGoalsError);
        }
      } else if (insertedAllGoals && insertedAllGoals.length > 0) {
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
// been synced yet (identified by HealthKit sample.uuid stored in activity_logs
// healthkit_data.synced_workout_ids), up to WORKOUT_MAX_DAILY per day per pack.
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

      // Insert activity_feed entries for each newly credited workout.
      //
      // Two distinct constraints govern this loop:
      //   - WORKOUT_MAX_DAILY scoring cap (max 2 feed rows per user/pack/day):
      //     enforced by the existingFeedCount-derived feedSlotsRemaining gate
      //     below. Even if the user has 3+ unique HK workout samples, only
      //     the first 2 produce feed rows.
      //   - Per-sample uniqueness (don't insert the same HK sample twice):
      //     enforced by the partial unique index idx_activity_feed_no_dup_hk_workouts
      //     on (user_id, healthkit_uuid). See src/lib/syncWater.ts:142 for
      //     the partial-index ON CONFLICT discussion — a plain INSERT with a
      //     23505 catch is the correct pattern here too. The partial index
      //     still enforces uniqueness on INSERT; concurrent re-syncs of the
      //     same sample raise 23505, which we treat as a successful no-op.
      // Both gates are needed; they cover different concerns.
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
        const sample = toCredit[i];
        const { data: insertedRows, error: feedError } = await supabase
          .from("activity_feed")
          .insert({
            pack_id,
            user_id: userId,
            activity_type: "workout",
            value: newCount,
            points_earned: Math.round(POINTS.workout * streakMultiplier),
            entry_method: "healthkit",
            score_date: date,
            healthkit_uuid: sample.identifier,
            category: getCategoryFromHKType(sample.activityType),
          })
          .select("id");

        if (feedError) {
          if (feedError.code !== "23505") {
            console.error(
              "[syncWorkoutsToSupabase] activity_feed insert error:",
              feedError,
            );
          }
          continue;
        }
        if (insertedRows && insertedRows.length > 0) {
          notifyPackMembers(userId, pack_id, {
            kind: "goal",
            activityType: "workout",
            pointsEarned: Math.round(POINTS.workout * streakMultiplier),
          }).catch(() => {});
        }
      }

      console.log(`[WorkoutSync] credited ${toCredit.length} new workout(s) for ${date} in pack ${pack_id}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// All-packs orchestrator — used by both foreground and background paths.
//
// Foreground: useHealthKit's syncAllPacks delegates here on mount + after
// activity logs. Background: app/_layout.tsx's subscribeToChanges callbacks
// invoke this when iOS wakes the app for HK observer events.
//
// ── Two-gate dedup design (Pass 6.5a-fix) ──────────────────────────────────
//
// We have TWO distinct fan-out problems and a separate gate for each. They
// are NOT redundant — removing either creates a regression.
//
//   1. Burst coalesce (within-wake, sub-second).
//      iOS routes a single HK wake event to every registered HKObserverQuery
//      callback — not just the type whose samples changed. With 3 types
//      registered (steps, calories, workouts), one wake fans out to 3 JS
//      callbacks within ~2ms. The in-memory `inFlightSync` flag + 500ms
//      window catch this: the first caller claims, the rest see the flag
//      set with a recent `lastBurstTs` and bail before doing any work.
//
//   2. Cross-wake throttle (between-wake, ~60s).
//      A second iOS wake event arriving 30s after the first would pass the
//      burst gate (different burst, flag already cleared). The AsyncStorage
//      `LAST_SYNC_KEY` stamp catches this: stamped on successful completion,
//      checked at function entry. HK reads are cumulative-sum, so skipping
//      a sync here doesn't lose data — the next sync after 60s picks up
//      everything that arrived in the meantime.
//
// Why both: the burst gate is in-memory (lost on app restart) and short
// (500ms). The cross-wake gate is durable (AsyncStorage survives JS reload)
// and long (60s). Neither can replace the other — burst coverage needs
// sub-second precision the AsyncStorage round-trip can't guarantee, and
// cross-wake coverage needs durability the in-memory flag can't provide.
// ─────────────────────────────────────────────────────────────────────────────

export async function syncHealthDataForUser(userId: string): Promise<void> {
  if (!nativeAvailable()) return;

  // Gate 1 — burst coalesce. Catches simultaneous observer fires from one
  // iOS wake before they race the AsyncStorage gate below. The leader
  // stamps `lastBurstTs` and proceeds; followers within COALESCE_WINDOW_MS
  // bail without doing any work.
  const now = Date.now();
  if (inFlightSync && now - lastBurstTs < COALESCE_WINDOW_MS) {
    return;
  }

  inFlightSync = true;
  lastBurstTs = now;

  try {
    // Gate 2 — cross-wake throttle. Skip if a sync ran within
    // SYNC_THROTTLE_MS. Catches a fresh wake event arriving inside the 60s
    // window the previous sync already covered.
    try {
      const lastIso = await AsyncStorage.getItem(LAST_SYNC_KEY);
      if (lastIso) {
        const elapsed = Date.now() - new Date(lastIso).getTime();
        if (elapsed >= 0 && elapsed < SYNC_THROTTLE_MS) return;
      }
    } catch {
      // AsyncStorage failure → proceed anyway. Throttle is a perf optimization,
      // not a correctness requirement.
    }

    // Fetch all active pack memberships
    const { data: memberships } = await supabase
      .from("pack_members")
      .select("pack_id")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (!memberships || memberships.length === 0) return;

    const packIds = memberships.map((m) => m.pack_id);

    // Fetch pack details
    const { data: packs } = await supabase
      .from("packs")
      .select("*")
      .in("id", packIds)
      .eq("is_active", true);

    if (!packs || packs.length === 0) return;

    // For each pack, get active run and sync today + 2-day backfill.
    await Promise.all([
      ...((packs as Pack[]).map(async (pack) => {
        const { data: run } = await supabase
          .from("runs")
          .select("id, start_date, end_date")
          .eq("pack_id", pack.id)
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!run) return;

        const tz = pack.timezone ?? "UTC";
        const todayStr = packToday(tz);

        // Build the backfill window: [today−2, today−1, today], in pack-tz.
        // Ordered oldest → newest. See WHY THIS ORDER MATTERS below.
        const days: string[] = [];
        for (let offset = 2; offset >= 0; offset--) {
          const d = new Date();
          d.setDate(d.getDate() - offset);
          days.push(
            new Intl.DateTimeFormat("en-CA", {
              timeZone: tz,
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(d),
          );
        }

        // ── WHY THIS ORDER MATTERS — DO NOT PARALLELIZE ─────────────────────
        //
        // The day loop writes daily_scores rows in oldest-first order:
        // day−2, then day−1, then today. This is *correctness*, not a perf
        // choice. Reordering or parallelizing this loop will silently break
        // streak computation.
        //
        // Why: syncHealthDataToSupabase computes streak_days by calling
        // computeStreakForRun(userId, runId, today, anyAchievedToday, tz),
        // which reads ALL prior daily_scores rows for the run with
        // score_date < today and walks backward looking for consecutive
        // `anyHit` rows.
        //
        // If we wrote today FIRST, then day−1, then day−2:
        //   • Today's compute reads day−1 / day−2 from BEFORE backfill,
        //     where they may not exist or may carry stale `_achieved` flags.
        //   • Today's row gets written with the wrong streak_days.
        //   • We then update day−1 and day−2 — but today's row already
        //     shipped with the broken streak. Realtime fires, the user sees
        //     the wrong number, no second pass corrects it.
        //
        // Writing day−2 first guarantees today's compute reads fresh
        // prior-day rows. The streak is correct on first write — no
        // recompute pass needed.
        //
        // Parallelizing (Promise.all over the 3 days) has the same
        // problem: today's promise can resolve before day−1's, and the
        // read/write interleave is undefined. Sequential oldest-first is
        // the only correct shape.
        //
        // If you're tempted to "speed this up" — don't. Each day is one HK
        // read + one Supabase upsert, ~100–300ms total. Three days
        // sequential is ~500ms in the typical case, and runs in the
        // background observer wake (the user is not waiting on it).
        // ────────────────────────────────────────────────────────────────────
        for (const scoreDate of days) {
          // TODO(6.5b cross-run): backfill currently writes ONLY into the
          // active run's window. Days that fall before run.start_date are
          // skipped — those belong to a previous run (post-rollover edge
          // case, e.g. it's Monday and we'd want to backfill Saturday).
          // Revisit if telemetry shows a "lost streak after weekly rollover"
          // pattern. The fix would be to resolve the historical run by
          // (pack_id, scoreDate within start..end) instead of relying on
          // status === active. Deferred from Pass 6.5b for scope.
          if (scoreDate < run.start_date) continue;

          const isToday = scoreDate === todayStr;
          await syncHealthDataToSupabase(
            userId,
            pack.id,
            run.id,
            pack,
            scoreDate,
            isToday ? "today" : "backfill",
          );
        }
      })),
      syncWorkoutsToSupabase(userId),
    ]);

    // Stamp on success so the cross-wake gate works on next call. On failure
    // we don't stamp, so the next invocation retries immediately.
    try {
      await AsyncStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
    } catch {
      // Same as above — non-fatal.
    }
  } finally {
    // Hold inFlightSync true for the full coalesce window after the leader
    // returns. Clearing immediately would let a follower that arrived a few
    // ms after the leader race past the burst gate. Held this long, every
    // member of the same wake-event burst sees the flag set.
    setTimeout(() => { inFlightSync = false; }, COALESCE_WINDOW_MS);
  }
}
