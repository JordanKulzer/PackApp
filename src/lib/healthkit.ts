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
import { WORKOUT_MAX_DAILY } from "./scoring";
import { computeUserStreak } from "./computeUserStreak";
// Goal-removal Part 3a: notifyPackMembers no longer used here — all
// kind:"goal" / kind:"all_goals" pushes are gone with the goal-hit
// framing. Threat-detection has its own internal push path.
import { type CrossingEvent } from "./competitiveDetection";
import { detectAndSendCategoryThreats, type CategoryDelta } from "./threatNotifications";
import { packToday, packDateRangeUTC } from "./packDates";
// Intentional-sharing Phase 1: getCategoryFromHKType no longer used —
// its only call site was the per-HK-sample activity_feed insert's
// `category` field, gone with the auto-post deletion. Phase 2's
// Share composer may import it again to seed the workout share's
// category from the HK sample type.
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
): Promise<CrossingEvent[]> {
  const crossings: CrossingEvent[] = [];
  if (!nativeAvailable()) return crossings;

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

  // Step 2a: Read prior row for delta computation + threat delta.
  // F.2: SELECT manual_*_count + hk_*_count separately. steps_count and
  // calories_count are now DB-generated (manual + hk); no need to read
  // them here — we have the components.
  //
  // Prompt 2 (streak migration): streak_days dropped from the SELECT.
  // Goal-removal Part 3a: *_achieved booleans dropped from the SELECT —
  // they're no longer read or written by this path. The Pass 9
  // transition-gating + per-type goal-hit feed inserts + all_goals
  // event that consumed them are all gone.
  const { data: priorRow } = await supabase
    .from("daily_scores")
    .select(
      "total_points, manual_steps_count, manual_calories_count, workout_count, hk_steps_count, hk_calories_count, hk_workout_count",
    )
    .eq("run_id", runId)
    .eq("user_id", userId)
    .eq("score_date", today)
    .maybeSingle();

  const prevManualSteps = priorRow?.manual_steps_count ?? 0;
  const prevManualCalories = priorRow?.manual_calories_count ?? 0;
  const prevWorkoutCount = priorRow?.workout_count ?? 0;
  const prevHkWorkouts = priorRow?.hk_workout_count ?? 0;

  // Prompt 2: prevStreak comes from users.current_streak, read BEFORE
  // computeUserStreak runs below. Pre-log GLOBAL streak; compared against
  // the post-log return value from computeUserStreak for milestone
  // detection. Replaces the prior priorRow.streak_days read.
  const { data: prevUserStreakRow } = await supabase
    .from("users")
    .select("current_streak")
    .eq("id", userId)
    .maybeSingle();
  const prevStreak =
    (prevUserStreakRow as { current_streak?: number } | null)
      ?.current_streak ?? 0;

  // Step 2b: HealthKit values are absolute snapshots — write them as the
  // absolute hk_*_count. The DB-generated steps_count / calories_count
  // (manual + hk) reflects the combined total automatically. Workout
  // count stays delta-based since it's not source-isolated (one
  // workout_count column tracks manual + HK additively, capped by
  // WORKOUT_MAX_DAILY).
  const cappedWorkouts = Math.min(workouts, WORKOUT_MAX_DAILY);
  const newHkSteps = Math.round(steps);
  const newHkCalories = Math.round(calories);
  const newHkWorkouts = cappedWorkouts;

  const hkWorkoutsDelta = Math.max(0, newHkWorkouts - prevHkWorkouts);

  // Combined totals (manual + HK) for achievement / scoring / feed value.
  // Match the DB-generated steps_count / calories_count exactly.
  const totalSteps = prevManualSteps + newHkSteps;
  const totalCalories = prevManualCalories + newHkCalories;
  const newWorkoutCount = Math.min(prevWorkoutCount + hkWorkoutsDelta, WORKOUT_MAX_DAILY);

  // Goal-removal Part 3a: Step 3 (steps_achieved/workout_achieved/calories_achieved/water_achieved
  // compute) is gone — the booleans are no longer read or written by this
  // path. The target columns they consumed (pack.step_target etc.) are
  // unused here too.

  // Step 7: Upsert to daily_scores. Prompt 2 (streak migration): streak_days
  // is no longer written here — users.current_streak (the GLOBAL streak,
  // maintained by computeUserStreak below) is authoritative everywhere.
  // Goal-removal Part 3a: *_achieved fields dropped from the payload.
  const { error: upsertError } = await supabase.from("daily_scores").upsert(
    {
      run_id: runId,
      user_id: userId,
      score_date: today,
      // F.2: steps_count / calories_count are DB-generated as
      // (manual + hk); writes against them would fail. HK only
      // writes its own absolute snapshot to hk_*_count.
      hk_water_count: Math.round(waterOz),
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

  // Prompt 2: recompute the per-user GLOBAL streak after the daily_scores
  // write. AWAITED so the return value feeds analytics + milestone gating
  // below. computeUserStreak provably never throws (top-level try/catch
  // returns 0); defensive wrap is belt-and-suspenders against unforeseen
  // exceptions breaking the sync.
  let newStreak = prevStreak;
  try {
    newStreak = await computeUserStreak(userId);
  } catch {
    // Defensive: leave newStreak as prevStreak — no milestone crosses.
  }

  // ── Streak milestone (mode === "today" only) ─────────────────────────
  //
  // Goal-removal Part 3a: the per-type activityLogged transitions block
  // (priorRow_*_achieved → transitions[]) is gone — the *_achieved gates
  // it relied on don't exist anymore. Background HK syncs would have
  // fired the emit per type per sync without that transition gate, which
  // is noise; dropping the analytics emit here is the cleanest cut.
  // streakMilestone still fires below — that's the meaningful state
  // change a sync can produce.
  if (mode === "today") {
    // Streak milestone — only the highest crossed threshold fires per update.
    // Backfill jumps could cross multiple at once; firing the highest avoids
    // a 3-event burst when streak goes 0 → 30+.
    // Prompt 2: prev/new both come from the GLOBAL streak now (prevStreak
    // pre-read from users.current_streak; newStreak from computeUserStreak).
    const STREAK_MILESTONES = [3, 7, 14, 30, 60, 90] as const;
    let crossed: 3 | 7 | 14 | 30 | 60 | 90 | null = null;
    let priorMilestone = 0;
    for (const m of STREAK_MILESTONES) {
      if (prevStreak >= m) priorMilestone = m;
      if (prevStreak < m && newStreak >= m) crossed = m;
    }
    if (crossed) {
      analytics.streakMilestone({
        milestone_days: crossed,
        pack_id: packId,
        prior_milestone_days: priorMilestone,
      });
    }

    // Categories pivot (Stage 2C): per-category passed_you / tied_you
    // threats. mode==="today" only (this whole block) — backfill must not
    // surface stale crossings as live notifications. Workouts is handled
    // by syncWorkoutsToSupabase; water is not HK-sourced for Pack.
    const oldHkSteps = priorRow?.hk_steps_count ?? 0;
    const oldHkCalories = priorRow?.hk_calories_count ?? 0;
    const threatChanges: CategoryDelta[] = [];
    if (newHkSteps !== oldHkSteps) {
      threatChanges.push({
        category: "steps",
        beforeValue: oldHkSteps + prevManualSteps,
        afterValue: newHkSteps + prevManualSteps,
      });
    }
    if (newHkCalories !== oldHkCalories) {
      threatChanges.push({
        category: "calories",
        beforeValue: oldHkCalories + prevManualCalories,
        afterValue: newHkCalories + prevManualCalories,
      });
    }
    if (threatChanges.length > 0) {
      detectAndSendCategoryThreats(userId, packId, runId, packTz, threatChanges).catch(
        () => {},
      );
    }
  }

  // Goal-removal Part 3a: the steps/calories/water activity_logs
  // idempotent inserts are gone — they were gated on *_achieved and
  // nothing reads activity_logs rows of those types anymore.
  //
  // The workout activity_logs primer survives. syncWorkoutsToSupabase
  // reads this row's synced_workout_ids to dedup per-sample credits;
  // without a primer it'd race with syncWorkoutsToSupabase to create
  // the row on first credit, so seeding it here (when any workouts
  // exist today) preserves the original guarantee. Gate switched from
  // workout_achieved → newWorkoutCount > 0 (equivalent condition for
  // the categories model, but reads off the count we already have).
  if (newWorkoutCount > 0) {
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
        points_earned: 0,
        activity_date: today,
        healthkit_data: { raw_value: cappedWorkouts, synced_workout_ids: [] },
      });
    }
  }

  // Goal-removal Part 3a: the entire activity_feed + push block here is
  // gone. It contained:
  //   • the achievedTypes / rawValues setup (built from *_achieved)
  //   • the per-type loop (mode === "today") that inserted
  //     activity_type: steps/calories/water rows + fired kind:"goal" pushes
  //   • the all_goals block that inserted activity_type: all_goals rows +
  //     fired kind:"all_goals" pushes
  // Under the categories pivot, none of these are goal-hit events anymore.
  // Threat-detection (passed_you / tied_you) above survives and remains
  // the live chat/push signal for HK syncs. Per-workout feed rows are
  // owned by syncWorkoutsToSupabase (per-sample uuid dedup), unaffected.

  console.log("[HealthKit Sync] Success:", {
    packId,
    hkSteps: newHkSteps,
    hkCalories: newHkCalories,
    hkWorkouts: newHkWorkouts,
    hkWorkoutsDelta,
    totalSteps,
    totalCalories,
    totalWorkouts: newWorkoutCount,
    waterOz,
    // Prompt 2: log the GLOBAL streak (computeUserStreak return) instead
    // of the dropped per-run streakDays variable.
    streakDays: newStreak,
  });

  return crossings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-workout deduplication sync
//
// Queries HealthKit for workouts from the past 2 days, credits any that haven't
// been synced yet (identified by HealthKit sample.uuid stored in activity_logs
// healthkit_data.synced_workout_ids), up to WORKOUT_MAX_DAILY per day per pack.
// ─────────────────────────────────────────────────────────────────────────────

export async function syncWorkoutsToSupabase(userId: string): Promise<CrossingEvent[]> {
  const crossings: CrossingEvent[] = [];
  if (!nativeAvailable()) return crossings;

  // Query workouts from 2 days ago to catch any retroactive data
  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  twoDaysAgo.setHours(0, 0, 0, 0);

  const samples = await getWorkoutSamples(twoDaysAgo);
  if (samples.length === 0) return crossings;

  // Group all samples by UTC date for initial bucketing — per-pack filtering
  // below re-checks using pack timezone once we know which pack we're in.
  const byDate = new Map<string, WorkoutSample[]>();
  for (const s of samples) {
    const date = s.endDate.split("T")[0];
    const bucket = byDate.get(date) ?? [];
    bucket.push(s);
    byDate.set(date, bucket);
  }

  if (byDate.size === 0) return crossings;

  // Get all active packs for this user
  const { data: memberships } = await supabase
    .from("pack_members")
    .select("pack_id")
    .eq("user_id", userId)
    .eq("is_active", true);

  if (!memberships?.length) return crossings;

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

      // Get current workout_count for this date/run.
      // Goal-removal Part 3a: *_achieved fields trimmed from this SELECT —
      // they were read into scope but never consumed (vestigial from the
      // pre-pivot world).
      const { data: scoreRow } = await supabase
        .from("daily_scores")
        .select("workout_count, hk_workout_count")
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

      // Upsert daily_scores with new workout count.
      // Goal-removal Part 3a: workout_achieved field dropped — the
      // boolean is no longer written by any path.
      await supabase.from("daily_scores").upsert(
        {
          run_id: run.id,
          user_id: userId,
          score_date: date,
          workout_count: newCount,
          hk_workout_count: (scoreRow?.hk_workout_count ?? 0) + toCredit.length,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "run_id,user_id,score_date" },
      );

      // Categories pivot (Stage 2C): workout threats. Today only — this
      // path also credits yesterday's workouts, but detectAndSendCategoryThreats
      // compares against today's daily_scores, so a yesterday delta would
      // mismatch. workout_count is the unified before/after value.
      if (date === todayStr && newCount !== currentCount) {
        detectAndSendCategoryThreats(userId, pack_id, run.id, packTz, [
          { category: "workouts", beforeValue: currentCount, afterValue: newCount },
        ]).catch(() => {});
      }

      // Update activity_logs — write synced_workout_ids back to the tracking row.
      // The row was already read as logRow above; update it if it exists, insert if not.
      if (logRow) {
        await supabase
          .from("activity_logs")
          .update({
            healthkit_data: { raw_value: newCount, synced_workout_ids: newSyncedIds },
            points_earned: 0,
          })
          .eq("id", logRow.id);
      } else {
        await supabase.from("activity_logs").insert({
          user_id: userId,
          activity_type: "workout",
          points_earned: 0,
          activity_date: date,
          healthkit_data: { raw_value: newCount, synced_workout_ids: newSyncedIds },
        });
      }

      // Intentional-sharing Phase 1: the per-HK-sample activity_feed
      // auto-post is gone, along with the WORKOUT_MAX_DAILY feed-cap
      // count query that gated it. Pack chat is becoming an intentional
      // surface; HK workout quantity telemetry no longer flows into it.
      //
      // Per-sample dedup against the same HK workout being credited
      // twice still survives via activity_logs.synced_workout_ids
      // (the workout primer + the update path above) — that's the
      // personal log, not chat. daily_scores.workout_count writes
      // also survive (the categories-pivot scoring path).
      //
      // crossings[] return is preserved (always empty now) — the
      // orchestrator's Promise.all discards it; type signature stable.
      console.log(`[WorkoutSync] credited ${toCredit.length} new workout(s) for ${date} in pack ${pack_id}`);
    }
  }
  return crossings;
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

  // Gate 0 — auth status. Background observer subscriptions in app/_layout.tsx
  // call into this orchestrator unconditionally on cold launch (HKObserverQuery
  // fires an initial completion handler per registered type, regardless of
  // auth state — Apple's design). Without this gate, every observer callback
  // proceeds to read HK, those reads throw on unauth, the per-reader catches
  // log [HealthKit] ... errors and return 0, and the orchestrator writes
  // zero-value daily_scores rows. Three cases this catches:
  //   • Simulator — no Health app, status stays "shouldRequest" forever.
  //   • Physical pre-prompt — auth never requested.
  //   • Revoked permission post-grant — user toggled off in iOS Settings.
  // Foreground entries (useHealthKit's syncAllPacks + syncNow) are already
  // hook-level auth-gated via `isAuthorized` state — this gate is for the
  // background observer wake path which has no equivalent gate. Returns
  // BEFORE stamping LAST_SYNC_KEY so post-grant resumption is immediate
  // (no 60s throttle stall from a stale auth-gated-skip stamp).
  if (!(await getHealthKitAuthStatus())) return;

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

        // ── Day loop runs sequentially (oldest-first) ───────────────────────
        //
        // Prompt 2 (streak migration): the old correctness reason for this
        // ordering — that syncHealthDataToSupabase called
        // computeStreakForRun which walked prior daily_scores rows — is
        // gone. The GLOBAL streak (computeUserStreak) reads
        // daily_checkins + activity_feed, not daily_scores, so day-order
        // no longer affects streak correctness.
        //
        // The loop stays sequential anyway: parallelizing 3 HK reads + 3
        // Supabase upserts runs hot against rate limits, and the work
        // happens in a background observer wake — the user is not
        // waiting on it. Each day is ~100–300ms; 3 sequential is ~500ms
        // typical. Safe to parallelize if a future perf need justifies it.
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
