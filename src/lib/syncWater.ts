import { supabase } from "./supabase";
import { computeStreakForRun } from "./computeStreak";
import { computeUserStreak } from "./computeUserStreak";
import { packToday, deviceLocalToday } from "./packDates";
import { notifyPackMembers } from "./notifications";
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
      const { data: pack } = await supabase
        .from("packs")
        .select("id, name, water_enabled, water_target_oz, timezone")
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

      // F.2: water_achieved requires both that the pack scores water
      // AND that the user hit the target. Count writes regardless.
      const water_achieved =
        pack.water_enabled && trueTotalOz >= pack.water_target_oz;

      const { data: existing } = await supabase
        .from("daily_scores")
        .select(
          "total_points, water_achieved, steps_achieved, workout_achieved, workout_count, calories_achieved, streak_days, manual_water_count, hk_water_count",
        )
        .eq("run_id", run.id)
        .eq("user_id", userId)
        .eq("score_date", today)
        .single();
      const prevStreakDays = existing?.streak_days ?? 0;
      const prevWaterAchieved = existing?.water_achieved ?? false;

      const anyAchieved =
        water_achieved ||
        (existing?.steps_achieved ?? false) ||
        (existing?.workout_achieved ?? false) ||
        (existing?.calories_achieved ?? false);
      const streakDays = await computeStreakForRun(userId, run.id, today, anyAchieved, packTz);

      const { error: upsertError } = await supabase.from("daily_scores").upsert(
        {
          run_id: run.id,
          user_id: userId,
          score_date: today,
          water_achieved,
          manual_water_count: Math.round(trueTotalOz),
          streak_days: streakDays,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "run_id,user_id,score_date" },
      );

      if (upsertError) {
        console.error("[LogSheet] daily_scores upsert error:", upsertError);
      }

      // Stage 2 streak rewrite: recompute the per-user GLOBAL streak after
      // every successful daily_scores write. computeStreakForRun above
      // continues to maintain the per-run daily_scores.streak_days value
      // for legacy Recap / per-pack surfaces. Fire-and-forget; never throws.
      computeUserStreak(userId).catch(() => {});

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
      // Transition gate uses `existing` (fresh DB read above), never in-memory.
      // Stage 2A: points_earned hard-zeroed and is_first_ever degraded to
      // false — the points-based first-ever gate is gone with the POINTS
      // table. A later sub-stage rebuilds is_first_ever on categories data.
      if (water_achieved && !prevWaterAchieved) {
        analytics.activityLogged({
          activity_type: "water",
          source: "manual",
          points_earned: 0,
          is_first_ever: false,
          streak_days_after: streakDays,
          goal_hit_today: anyAchieved,
        });
      }

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

      if (water_achieved) {
        // ── activity_feed idempotent insert — race-safe via 23505 catch ────
        //
        // ANCHOR EXPLANATION (referenced by 4 other call sites in
        // src/lib/healthkit.ts and src/lib/logActivity.ts).
        //
        // We previously used `.upsert(..., { onConflict: "...", ignoreDuplicates: true })`
        // here, but that fails with Postgres error 42P10 ("no unique or
        // exclusion constraint matching the ON CONFLICT specification").
        //
        // Why: the unique constraint on activity_feed is a PARTIAL unique
        // index (idx_activity_feed_no_dup_goals from migration 20260428b,
        // extended in 20260429):
        //
        //   CREATE UNIQUE INDEX idx_activity_feed_no_dup_goals
        //     ON activity_feed (user_id, pack_id, activity_type, score_date)
        //     WHERE activity_type IN ('steps', 'calories', 'water',
        //                             'took_lead', 'all_goals');
        //
        // Postgres can match a NON-partial unique index from columns alone
        // in `ON CONFLICT (cols)`. But for a PARTIAL index, the planner
        // requires the WHERE predicate to be specified explicitly in
        // `ON CONFLICT (cols) WHERE predicate` — see Postgres docs:
        //   https://www.postgresql.org/docs/current/sql-insert.html
        //   "If an index_predicate is specified, it must, as a further
        //    requirement for inference, satisfy arbiter indexes."
        //
        // supabase-js's `onConflict` parameter only accepts a comma-
        // separated column list — there is no syntax for the WHERE
        // predicate. So the partial index cannot be used as an arbiter
        // via the JS client. Hence 42P10.
        //
        // The fix: plain INSERT with a 23505 (unique_violation) catch.
        // The partial unique index STILL enforces uniqueness on INSERT —
        // it just can't be inferred as an ON CONFLICT arbiter. So the
        // race shape is:
        //   - Single writer: INSERT succeeds, side effects fire normally
        //   - Concurrent writers: one INSERT wins, the other gets 23505;
        //     we treat 23505 as a successful no-op (the row that "would
        //     have been the dup" was already written)
        // This preserves the previous `ignoreDuplicates: true` semantics
        // exactly: concurrent re-fires are silent no-ops, side effects
        // (notifyPackMembers) only fire on the writer that won the race.
        //
        // 23505 is NOT logged as an error — it's the expected race
        // outcome. Other error codes still log.
        const { data: insertedRows, error: feedInsertError } = await supabase
          .from("activity_feed")
          .insert({
            pack_id: pack.id,
            user_id: userId,
            activity_type: "water",
            value: Math.round(trueTotalOz),
            points_earned: 0,
            entry_method: "manual",
            score_date: today,
          })
          .select("id");

        if (feedInsertError) {
          if (feedInsertError.code !== "23505") {
            console.error(
              "[syncWater] activity_feed insert error:",
              feedInsertError,
            );
          }
        } else if (insertedRows && insertedRows.length > 0) {
          crossings.push({
            packId: pack.id,
            packName: pack.name,
            packTimezone: packTz,
            feedItemId: insertedRows[0].id,
            activityType: "water",
            pointsEarned: 0,
            scoreDate: today,
          });
          notifyPackMembers(userId, pack.id, {
            kind: "goal",
            activityType: "water",
          }).catch(() => {});
        }
      }

    }
  } catch (err) {
    console.error("[LogSheet] syncWaterToDailyScores error:", err);
  }
  return crossings;
}
