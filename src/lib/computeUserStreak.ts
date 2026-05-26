import { supabase } from "./supabase";
import { deviceLocalToday, deviceLocalDateOffset } from "./packDates";

// ─────────────────────────────────────────────────────────────────────────────
// Per-user GLOBAL streak compute (Stage 2 streak rewrite).
//
// A day "counts" for a user if EITHER:
//   - a daily_checkins row exists for that date (user tapped the box), or
//   - the user manually logged any activity that date — detected via:
//       * daily_scores row with manual_steps_count > 0, OR
//         manual_calories_count > 0, OR manual_water_count > 0, OR
//       * a manual WORKOUT — derived as
//           workout_count - hk_workout_count > 0
//         (no `manual_workout_count` column exists; manual workout
//         logs increment `workout_count` only, while HK syncs
//         increment both `workout_count` and `hk_workout_count`, so
//         the difference IS the manual count), OR
//       * water_logs row.
//
// The original Stage 2 design detected manual logs via an
// activity_feed row with entry_method='manual'. Intentional-Sharing
// Phase 1 stopped writing those rows (manual logs no longer auto-post
// to chat — Phase 2's composer is the only writer now), which broke
// streak counting silently. This bug fix points the same OR-rule at
// the data sources manual logs DO write (daily_scores manual_* cols +
// derived manual-workout + water_logs). HK-synced workouts were NEVER
// in the signal — only manual logs counted before, and only manual
// logs count now. A pure-HK-workout day (workout_count ==
// hk_workout_count) does NOT contribute.
//
// Manual-workout derivation caveat: WORKOUT_MAX_DAILY caps
// `workout_count` server-side in healthkit.ts's sync path. In a rare
// edge case (e.g. user logs 1 manual workout AND HK syncs 12+ HK
// workouts the same day), the cap can drive `workout_count -
// hk_workout_count` negative, making the day appear non-manual for
// streak purposes. Accepted: a user that active almost certainly has
// other manual signals (steps/calories/water) that satisfy the day
// anyway. Do NOT "fix" the cap thinking the underflow is a bug — the
// cap is intentional and the edge case is rare enough not to matter.
//
// "Today" is the device's local timezone (deviceLocalToday) — same convention
// the check-in box uses when writing daily_checkins.score_date. The function
// is independent of any pack-run: it writes the cached fields on the users
// table (current_streak / best_streak / last_streak_date), which every
// surface that displays the streak will eventually read from.
//
// Walk model — "alive-but-at-risk":
//   - Start at YESTERDAY (not today). Walk backward while each cursor day is
//     in the satisfied set, counting consecutive days.
//   - If today is satisfied, add 1.
//   - So a user with 5 prior days who hasn't logged yet today still shows
//     "5" until tomorrow's midnight — they don't see their streak briefly
//     zero just because it's morning.
//   - A user who missed yesterday entirely returns 0 (or 1 if today already
//     satisfied).
//
// Error model: this function NEVER throws. Internal errors are caught and
// logged. Callers (the 3 sync paths + the foreground bootstrap) should still
// wrap in a defensive `.catch()` for extra safety, but the streak compute
// failing must never break a log/sync/app-launch.
// ─────────────────────────────────────────────────────────────────────────────

// Bounded backward window. 365 days reaches an annual "best streak" without
// pulling unbounded history. The PK on daily_checkins makes the read cheap
// even within a 365-row window; the activity_feed read is similarly bounded
// by score_date.
const WINDOW_DAYS = 365;

// Prompt 1 (streak read-site migration): signature changed from
// Promise<void> → Promise<number>. The sync paths (logActivity, syncWater,
// healthkit) will use the returned currentStreak for analytics / streak-
// milestone gating in Prompt 2 once the old computeStreakForRun call is
// removed. For now all callers still ignore the return value — adding the
// return is non-breaking. Error / early-return paths return 0 (no streak
// surface should ever throw or stay "uninitialized" on this function).
export async function computeUserStreak(userId: string): Promise<number> {
  try {
    const today = deviceLocalToday();
    const yesterday = deviceLocalDateOffset(1);
    const windowStart = deviceLocalDateOffset(WINDOW_DAYS);

    // Parallel reads — three date sources (check-ins, daily_scores
    // manual lanes, water_logs) plus the user's existing best_streak so
    // we can compute the new max in JS (supabase-js can't express
    // `best_streak = GREATEST(best_streak, $1)` cleanly without an RPC,
    // and Stage 2 is explicitly no-new-RPCs).
    //
    // Why three: daily_checkins covers the check-in tap; daily_scores
    // (manual_* > 0 OR workout_count > hk_workout_count) covers manual
    // steps/calories/water/workout logs that landed via
    // syncManualActivityToDailyScores / syncWaterToDailyScores;
    // water_logs is a per-log table that water touches in addition to
    // daily_scores. Reading both lets the satisfied-set survive any
    // single-write blip on either side. The .or() filter is coarse —
    // workout_count.gt.0 pulls HK-only rows too, which are filtered
    // out in the JS satisfied-set build below by the manual-workout
    // derivation (workout_count > hk_workout_count). HK-only days
    // never contribute — only the manual portion counts.
    const [checkinsRes, manualScoresRes, waterLogsRes, userRes] = await Promise.all([
      supabase
        .from("daily_checkins")
        .select("score_date")
        .eq("user_id", userId)
        .gte("score_date", windowStart),
      // daily_scores: read updated_at (UTC timestamp) so we can derive
      // device-local YYYY-MM-DD in JS. The row's score_date is in PACK
      // timezone, which doesn't match the walk's device-local cursor —
      // using updated_at sidesteps the pack-tz midnight-boundary issue
      // the prior comment block acknowledged. .gte("score_date",
      // windowStart) is a coarse prefilter to bound row count; the
      // device-local date derived below is what actually enters the
      // satisfied set. workout_count + hk_workout_count are SELECTed
      // so the manual-workout derivation (workout_count -
      // hk_workout_count > 0) can run in JS — PostgREST doesn't
      // support column-vs-column comparisons in filters.
      supabase
        .from("daily_scores")
        .select(
          "updated_at, manual_steps_count, manual_calories_count, manual_water_count, workout_count, hk_workout_count",
        )
        .eq("user_id", userId)
        .gte("score_date", windowStart)
        .or(
          "manual_steps_count.gt.0,manual_calories_count.gt.0,manual_water_count.gt.0,workout_count.gt.0",
        ),
      // water_logs.log_date is already device-local YYYY-MM-DD (written
      // via deviceLocalToday() in LogSheet) — add directly, no
      // conversion needed.
      supabase
        .from("water_logs")
        .select("log_date")
        .eq("user_id", userId)
        .gte("log_date", windowStart),
      supabase
        .from("users")
        .select("best_streak")
        .eq("id", userId)
        .maybeSingle(),
    ]);

    if (checkinsRes.error) {
      console.error(
        "[computeUserStreak] daily_checkins select error:",
        checkinsRes.error,
      );
      return 0;
    }
    if (manualScoresRes.error) {
      console.error(
        "[computeUserStreak] daily_scores select error:",
        manualScoresRes.error,
      );
      return 0;
    }
    if (waterLogsRes.error) {
      console.error(
        "[computeUserStreak] water_logs select error:",
        waterLogsRes.error,
      );
      return 0;
    }
    if (userRes.error) {
      console.error(
        "[computeUserStreak] users select error:",
        userRes.error,
      );
      return 0;
    }

    // Build the set of satisfied YYYY-MM-DD dates in DEVICE-LOCAL tz.
    // daily_checkins.score_date and water_logs.log_date are already
    // device-local strings — added directly. daily_scores carries a
    // pack-tz score_date; we derive device-local date from updated_at
    // (UTC timestamp) instead — getFullYear/getMonth+1/getDate matches
    // deviceLocalToday's Hermes-safe pattern. Set dedups across sources
    // (a manual water log writes both water_logs AND daily_scores).
    const satisfied = new Set<string>();
    for (const row of (checkinsRes.data ?? []) as Array<{ score_date: string }>) {
      satisfied.add(row.score_date);
    }
    for (const row of (waterLogsRes.data ?? []) as Array<{ log_date: string }>) {
      satisfied.add(row.log_date);
    }
    for (const row of (manualScoresRes.data ?? []) as Array<{
      updated_at: string;
      manual_steps_count: number | null;
      manual_calories_count: number | null;
      manual_water_count: number | null;
      workout_count: number | null;
      hk_workout_count: number | null;
    }>) {
      // The .or() filter widens the pull to include rows with
      // workout_count.gt.0 — but HK-only-workout rows must NOT count
      // as manual activity. Derive the manual-workout count and
      // gate the add on at least one manual signal being non-zero.
      const manualWorkout =
        (row.workout_count ?? 0) - (row.hk_workout_count ?? 0) > 0;
      const anyManual =
        (row.manual_steps_count ?? 0) > 0 ||
        (row.manual_calories_count ?? 0) > 0 ||
        (row.manual_water_count ?? 0) > 0 ||
        manualWorkout;
      if (!anyManual) continue;
      const d = new Date(row.updated_at);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      satisfied.add(`${y}-${m}-${day}`);
    }

    // Walk backward from yesterday. WINDOW_DAYS bound prevents an infinite
    // loop on impossibly-long chains (year+).
    let chainEndingYesterday = 0;
    for (let offset = 1; offset <= WINDOW_DAYS; offset++) {
      const cursor = deviceLocalDateOffset(offset);
      if (!satisfied.has(cursor)) break;
      chainEndingYesterday++;
    }

    const todaySatisfied = satisfied.has(today);
    const currentStreak = chainEndingYesterday + (todaySatisfied ? 1 : 0);

    // last_streak_date: today if today's in the set; else the most-recent
    // day of the yesterday-anchored chain (= yesterday) if that chain exists;
    // else null (no streak at all).
    let lastStreakDate: string | null = null;
    if (todaySatisfied) {
      lastStreakDate = today;
    } else if (chainEndingYesterday > 0) {
      lastStreakDate = yesterday;
    }

    const prevBest = userRes.data?.best_streak ?? 0;
    const newBest = Math.max(prevBest, currentStreak);

    const { error: updateError } = await supabase
      .from("users")
      .update({
        current_streak: currentStreak,
        best_streak: newBest,
        last_streak_date: lastStreakDate,
      })
      .eq("id", userId);

    if (updateError) {
      console.error("[computeUserStreak] users update error:", updateError);
    }

    return currentStreak;
  } catch (err) {
    console.error("[computeUserStreak] error:", err);
    return 0;
  }
}
