import { supabase } from "./supabase";
import { deviceLocalToday, deviceLocalDateOffset } from "./packDates";

// ─────────────────────────────────────────────────────────────────────────────
// Per-user GLOBAL streak compute (Stage 2 streak rewrite).
//
// A day "counts" for a user if EITHER:
//   - a daily_checkins row exists for that date (user tapped the box), or
//   - an activity_feed row with entry_method='manual' exists for that date.
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

    // Parallel reads — both date sources, plus the user's existing
    // best_streak so we can compute the new max in JS (supabase-js can't
    // express `best_streak = GREATEST(best_streak, $1)` cleanly without
    // an RPC, and Stage 2 is explicitly no-new-RPCs).
    const [checkinsRes, manualFeedRes, userRes] = await Promise.all([
      supabase
        .from("daily_checkins")
        .select("score_date")
        .eq("user_id", userId)
        .gte("score_date", windowStart),
      supabase
        .from("activity_feed")
        .select("score_date")
        .eq("user_id", userId)
        .eq("entry_method", "manual")
        .gte("score_date", windowStart),
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
    if (manualFeedRes.error) {
      console.error(
        "[computeUserStreak] activity_feed select error:",
        manualFeedRes.error,
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

    // Build the set of satisfied YYYY-MM-DD dates. activity_feed rows are
    // pack-scoped — one row per (manual log, active pack) — so a user in N
    // packs will have N rows per manual log; dedup via the Set.
    //
    // Note (flagged in Stage 2 audit): activity_feed.score_date is in pack
    // timezone, not device timezone. The walk uses device-tz dates. For
    // most users (packs near their device tz) this matches. Edge cases at
    // the midnight boundary in far-shifted packs may briefly mis-attribute
    // a log to today vs tomorrow — the check-in box is the safety net for
    // exact device-tz dates.
    const satisfied = new Set<string>();
    for (const row of (checkinsRes.data ?? []) as Array<{ score_date: string }>) {
      satisfied.add(row.score_date);
    }
    for (const row of (manualFeedRes.data ?? []) as Array<{ score_date: string }>) {
      satisfied.add(row.score_date);
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
