// Shared helper for seeding a new pack member's first daily_scores row.
// Used by BOTH the in-app JoinPackModal AND the app/join/[code].tsx
// deep-link join screen so the two paths can't drift.
//
// Why this exists: pre-F.2 the modal had inline seed logic while the
// deep-link path skipped seeding entirely (Bug 8), so users joining
// via invite link wouldn't appear on the leaderboard until their
// first activity logged. This helper closes that gap and centralizes
// the seed-shape so future column changes (e.g. the generated
// steps_count / calories_count from migration 20260513b) only need
// to be updated in one place.

import { supabase } from "./supabase";
import { packToday, deviceLocalToday } from "./packDates";
import {
  getStepsForRange,
  getActiveCaloriesForRange,
  isHealthKitAvailable,
} from "./healthkit";
import { Platform } from "react-native";

export interface SeedablePack {
  id: string;
  timezone: string | null;
  steps_enabled: boolean;
  workouts_enabled: boolean;
  calories_enabled: boolean;
  water_enabled: boolean;
  step_target: number;
  calorie_target: number;
  water_target_oz: number;
}

/**
 * Seeds a daily_scores row for (userId, activeRunId, today-in-pack-tz).
 *
 * Backfills:
 *   • water_oz_count    — sum of water_logs for today (device-local date)
 *   • hk_steps_count    — today's HK step count (if authorized + iOS)
 *   • hk_calories_count — today's HK active calories (if authorized + iOS)
 *   • *_achieved flags  — computed against pack targets so the new member's
 *                          row reflects already-met goals immediately
 *
 * Does NOT touch steps_count / calories_count (DB-generated as
 * manual + hk per migration 20260513b). Manual counts start at zero;
 * subsequent manual logs flow through logActivity.ts.
 *
 * Idempotent: upserts on (run_id, user_id, score_date). Safe to call
 * multiple times — the second call would just re-compute the same
 * seed values.
 *
 * Failures are logged and swallowed: a seed failure should not block
 * the join itself. The next HK sync / manual log will create the row
 * if this one missed.
 */
export async function seedDailyScoresOnJoin(
  userId: string,
  pack: SeedablePack,
  activeRunId: string,
): Promise<void> {
  try {
    const packTz = pack.timezone ?? "UTC";
    const today = packToday(packTz);

    // Water: device-local log_date, matching LogSheet's INSERT shape.
    // See packDates.ts for why deviceLocalToday() not Intl.
    const deviceToday = deviceLocalToday();
    const { data: waterRows } = await supabase
      .from("water_logs")
      .select("amount_oz")
      .eq("user_id", userId)
      .eq("log_date", deviceToday);
    const waterOz = Math.round(
      (waterRows ?? []).reduce((sum, r) => sum + r.amount_oz, 0),
    );

    // HK: read today's steps + calories if available. Pack-tz day bounds
    // for read-range parity with healthkit.ts (which uses packDateRangeUTC).
    // Joining typically happens during the day, so reading "now" is fine —
    // the next syncHealthDataForUser will write the canonical absolute.
    let hkSteps = 0;
    let hkCalories = 0;
    if (Platform.OS === "ios" && isHealthKitAvailable()) {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      [hkSteps, hkCalories] = await Promise.all([
        getStepsForRange(start, end),
        getActiveCaloriesForRange(start, end),
      ]);
    }

    const steps_achieved =
      pack.steps_enabled && hkSteps >= pack.step_target;
    const calories_achieved =
      pack.calories_enabled && hkCalories >= pack.calorie_target;
    const water_achieved =
      pack.water_enabled && waterOz >= pack.water_target_oz;

    // Prompt 2 (streak migration): streak_days dropped from this upsert.
    // The column keeps its DB default (0) for the new row; the user's
    // GLOBAL streak (users.current_streak) is the authoritative streak
    // and is independent of this per-pack join event.
    const { error } = await supabase.from("daily_scores").upsert(
      {
        run_id: activeRunId,
        user_id: userId,
        score_date: today,
        steps_achieved,
        workout_achieved: false,
        calories_achieved,
        water_achieved,
        manual_water_count: waterOz,
        hk_steps_count: hkSteps,
        hk_calories_count: hkCalories,
        hk_workout_count: 0,
        workout_count: 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "run_id,user_id,score_date" },
    );

    if (error) {
      console.error("[seedDailyScoresOnJoin] upsert error:", error);
    }
  } catch (err) {
    console.error("[seedDailyScoresOnJoin] unexpected error:", err);
  }
}
