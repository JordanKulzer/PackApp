import { supabase } from "./supabase";
import { computeUserStreak } from "./computeUserStreak";
import { packToday, deviceLocalToday } from "./packDates";
// Goal-removal Part 3a: notifyPackMembers no longer used — the only
// caller was the kind:"goal" push that fired on water_achieved crossing,
// which is gone with the goal-hit framing.
import { type CrossingEvent } from "./competitiveDetection";
import { detectAndSendCategoryThreats } from "./threatNotifications";
import { analytics } from "./analytics";

export async function syncWaterToDailyScores(userId: string): Promise<CrossingEvent[]> {
  const crossings: CrossingEvent[] = [];
  try {
    const { data: memberships, error: memberError } = await supabase
      .from("pack_members")
      .select("pack_id")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (memberError || !memberships || memberships.length === 0) return crossings;

    for (const membership of memberships) {
      // Goal-removal Part 3a: water_target_oz dropped from the SELECT —
      // the water_achieved boolean it gated is gone with the goal-hit
      // framing.
      const { data: pack } = await supabase
        .from("packs")
        .select("id, name, water_enabled, timezone")
        .eq("id", membership.pack_id)
        .single();

      if (!pack) continue;
      // F.2 Bug 3: water_oz_count tracks regardless of water_enabled.
      // water_enabled gates the achievement / points credit only —
      // water consumption is real and worth recording per-pack even
      // when scoring doesn't credit it.

      const packTz = pack.timezone ?? "UTC";
      const today = packToday(packTz);

      const { data: run } = await supabase
        .from("runs")
        .select("id")
        .eq("pack_id", pack.id)
        .eq("status", "active")
        .single();

      if (!run) continue;

      // F.2 Bug 3 fix: deviceLocalToday() matches the getDate()-based
      // log_date string LogSheet writes to water_logs. Was an
      // Intl.DateTimeFormat("en-CA") call without a timeZone option,
      // which Hermes resolves inconsistently (UTC-leak observed at
      // 01:48 UTC → next-day string → zero water_logs matched).
      const deviceToday = deviceLocalToday();
      const { data: todayLogs } = await supabase
        .from("water_logs")
        .select("amount_oz")
        .eq("user_id", userId)
        .eq("log_date", deviceToday);

      const trueTotalOz = (todayLogs ?? []).reduce(
        (sum, row) => sum + row.amount_oz,
        0,
      );

      // Goal-removal Part 3a: water_achieved compute + prevWaterAchieved
      // + anyAchieved are gone. The *_achieved booleans no longer gate
      // the analytics emit, the activity_feed insert, or the push. The
      // SELECT below drops the four *_achieved columns since nothing
      // reads them anymore.
      //
      // Prompt 2 (streak migration): streak_days already dropped.
      const { data: existing } = await supabase
        .from("daily_scores")
        .select(
          "total_points, workout_count, manual_water_count, hk_water_count",
        )
        .eq("run_id", run.id)
        .eq("user_id", userId)
        .eq("score_date", today)
        .single();

      // Prompt 2: prevStreak comes from users.current_streak, read BEFORE
      // computeUserStreak runs below. Pre-log value; compared against the
      // post-log return value from computeUserStreak for milestone detection.
      const { data: prevUserStreakRow } = await supabase
        .from("users")
        .select("current_streak")
        .eq("id", userId)
        .maybeSingle();
      const prevStreak =
        (prevUserStreakRow as { current_streak?: number } | null)
          ?.current_streak ?? 0;

      // Prompt 2: streak_days no longer written — users.current_streak is
      // the authoritative streak. Goal-removal Part 3a: water_achieved
      // also dropped from this payload.
      const { error: upsertError } = await supabase.from("daily_scores").upsert(
        {
          run_id: run.id,
          user_id: userId,
          score_date: today,
          manual_water_count: Math.round(trueTotalOz),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "run_id,user_id,score_date" },
      );

      if (upsertError) {
        console.error("[LogSheet] daily_scores upsert error:", upsertError);
      }

      // Prompt 2: recompute the per-user GLOBAL streak after the
      // daily_scores write. AWAITED so the return value feeds analytics +
      // milestone gating below. computeUserStreak provably never throws
      // (top-level try/catch returns 0); defensive wrap is belt-and-
      // suspenders against unforeseen exceptions breaking the log.
      let newStreak = prevStreak;
      try {
        newStreak = await computeUserStreak(userId);
      } catch {
        // Defensive: leave newStreak as prevStreak — no milestone crosses.
      }

      // Categories pivot (Stage 2C): per-category passed_you / tied_you
      // threats. Water's before value is the prior manual + hk lanes; the
      // after value swaps the manual lane for this sync's trueTotalOz.
      const oldManualWater = existing?.manual_water_count ?? 0;
      const currentHkWater = existing?.hk_water_count ?? 0;
      detectAndSendCategoryThreats(userId, pack.id, run.id, packTz, [
        {
          category: "water",
          beforeValue: oldManualWater + currentHkWater,
          afterValue: Math.round(trueTotalOz) + currentHkWater,
        },
      ]).catch(() => {});

      // ── Pass 9 funnel: activity_logged (water) + streak_milestone ──
      // Goal-removal Part 3a: gate dropped. water_achieved/prevWaterAchieved
      // are gone; activityLogged now fires once per water sync per pack
      // (the user-facing event is "added water"). goal_hit_today field
      // gone with the rest of the goal-hit framing.
      analytics.activityLogged({
        activity_type: "water",
        source: "manual",
        points_earned: 0,
        is_first_ever: false,
        // Prompt 2: GLOBAL streak from computeUserStreak above.
        streak_days_after: newStreak,
      });

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

      // Goal-removal Part 3a: the `if (water_achieved)` block — which
      // inserted an activity_feed row + fired the kind:"goal" push when
      // the user crossed the water target — is gone. Water is now a
      // count-only signal in the categories model; threat-detection above
      // surfaces water-category lead changes; no per-cross chat event or
      // notification fires from this path anymore.

    }
  } catch (err) {
    console.error("[LogSheet] syncWaterToDailyScores error:", err);
  }
  return crossings;
}
