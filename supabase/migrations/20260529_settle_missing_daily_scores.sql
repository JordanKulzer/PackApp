-- ─────────────────────────────────────────────────────────────────────────────
-- Settle missing daily_scores rows.
--
-- BEFORE this migration: compute_daily_winners_for_pack iterates each
-- settled day in each active/completed run and writes daily_winners rows
-- per category, but never creates daily_scores rows for members who did
-- nothing that day. Net effect: a member who didn't open the app (and
-- whose HealthKit sync therefore never fired) leaves NO daily_scores row
-- for that day, while a member who opened the app gets a 0-row from the
-- HK sync. The trend chart then sees a mix of "absent days" (gap) and
-- "zero days" (flat line at 0) for the same kind of inactive day —
-- visually inconsistent.
--
-- AFTER this migration: the function additionally writes a per-member
-- 0-row for every settled day in the run (start_date..yesterday in pack-
-- tz), using INSERT ... ON CONFLICT DO NOTHING. Existing rows (real
-- activity OR late HealthKit backfill arriving AFTER the settle) are
-- never clobbered. Winner computation is UNCHANGED: the per-category
-- MAX(...) > 0 guards in the four blocks below already ignore zero rows,
-- and the settle insert runs AFTER the winner blocks for the same day
-- (double-safe — even though the > 0 filter alone would be enough).
--
-- Why this is competition-safe:
--   • Winner SQL filters WHERE <col> > 0 — settle-0 rows are inert.
--   • computeUserStreak gates on manual_* > 0 / workout-derived > 0 —
--     settle-0 rows can never satisfy the streak set.
--   • manuallyLoggedToday in useLogActivitySheetData also > 0-gated.
--   • usePackCategoryStandings pre-pads every member to 0 anyway, so
--     row-presence on today is already irrelevant (and settle is for
--     YESTERDAY-and-back, not today).
-- No downstream surface distinguishes "row absent" from "row with 0";
-- every value-consuming read in the codebase is > 0-gated.
--
-- Idempotency: re-running the function is safe and cheap — DO NOTHING
-- makes every repeat settle a no-op. The first run after deploy
-- naturally backfills the active run's elapsed settled days via the
-- existing WHILE loop (start_date..yesterday), so no separate one-shot
-- backfill script is needed. Going forward each new settled day picks
-- up its 0-rows on the next invocation.
--
-- Engagement caveat: this RPC is client-triggered (home.tsx fire-and-
-- forget on Home open) plus once at run rollover (20260520 stage 3a).
-- There is no pg_cron in the repo. A pack where nobody opens the app
-- for several days produces neither winners nor settle-rows during
-- that quiet window — the next person to open the app catches both up.
--
-- LIVE SCHEMA NOTES (confirmed by user from Studio):
--   • UNIQUE (run_id, user_id, score_date) → DO NOTHING target.
--   • NOT NULL DEFAULT 0 on every source column we write below.
--   • GENERATED ALWAYS (NOT WRITTEN below): steps_count, calories_count,
--     water_oz_count. Postgres rejects writes to these; we set their
--     sources and let the generated columns compute.
--   • No triggers on daily_scores.
--
-- Single change vs the prior function body: the new INSERT block marked
-- "── Settle-missing-rows step ──" below. Everything else (signature,
-- declares, pack load, yesterday compute, solo-pack guard, run loop,
-- day loop bounds, the four per-category winner blocks, the increment,
-- end markers) is byte-for-byte the same as the function defined in
-- 20260519_categories_pivot_stage1.sql:153-284.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.compute_daily_winners_for_pack(p_pack_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_pack record;
  v_timezone text;
  v_yesterday date;
  v_active_member_count integer;
  v_last_computed date;
  v_current_date date;
  v_run record;
  v_winning_value integer;
  v_winner_ids uuid[];
BEGIN
  -- Load pack
  SELECT * INTO v_pack FROM public.packs WHERE id = p_pack_id;
  IF NOT FOUND THEN RETURN; END IF;
  v_timezone := COALESCE(v_pack.timezone, 'UTC');

  -- Yesterday in pack timezone
  v_yesterday := (now() AT TIME ZONE v_timezone)::date - 1;

  -- Skip solo packs
  SELECT COUNT(*) INTO v_active_member_count
    FROM public.pack_members
    WHERE pack_id = p_pack_id AND is_active = true;
  IF v_active_member_count <= 1 THEN RETURN; END IF;

  -- Find last computed winner date for this pack
  SELECT MAX(score_date) INTO v_last_computed
    FROM public.daily_winners WHERE pack_id = p_pack_id;

  -- Iterate over each active or completed run whose date range overlaps
  -- with (v_last_computed, v_yesterday]
  FOR v_run IN
    SELECT * FROM public.runs
    WHERE pack_id = p_pack_id
      AND status IN ('active', 'completed')
      AND start_date <= v_yesterday
    ORDER BY start_date
  LOOP
    -- For each day in this run's range, up to yesterday, not yet computed
    v_current_date := GREATEST(v_run.start_date, COALESCE(v_last_computed + 1, v_run.start_date));
    WHILE v_current_date <= LEAST(v_run.end_date, v_yesterday) LOOP

      -- ── Steps category ──────────────────────────────────────────────
      IF v_pack.steps_enabled THEN
        SELECT MAX(steps_count) INTO v_winning_value
          FROM public.daily_scores
          WHERE run_id = v_run.id
            AND score_date = v_current_date
            AND steps_count > 0;
        IF v_winning_value IS NOT NULL AND v_winning_value > 0 THEN
          SELECT ARRAY_AGG(user_id) INTO v_winner_ids
            FROM public.daily_scores
            WHERE run_id = v_run.id
              AND score_date = v_current_date
              AND steps_count = v_winning_value;
          INSERT INTO public.daily_winners
            (pack_id, run_id, score_date, category, winner_user_ids, winning_metric_value)
            VALUES (p_pack_id, v_run.id, v_current_date, 'steps', v_winner_ids, v_winning_value)
            ON CONFLICT (pack_id, score_date, category) DO NOTHING;
        END IF;
      END IF;

      -- ── Workouts category ───────────────────────────────────────────
      IF v_pack.workouts_enabled THEN
        SELECT MAX(workout_count) INTO v_winning_value
          FROM public.daily_scores
          WHERE run_id = v_run.id
            AND score_date = v_current_date
            AND workout_count > 0;
        IF v_winning_value IS NOT NULL AND v_winning_value > 0 THEN
          SELECT ARRAY_AGG(user_id) INTO v_winner_ids
            FROM public.daily_scores
            WHERE run_id = v_run.id
              AND score_date = v_current_date
              AND workout_count = v_winning_value;
          INSERT INTO public.daily_winners
            (pack_id, run_id, score_date, category, winner_user_ids, winning_metric_value)
            VALUES (p_pack_id, v_run.id, v_current_date, 'workouts', v_winner_ids, v_winning_value)
            ON CONFLICT (pack_id, score_date, category) DO NOTHING;
        END IF;
      END IF;

      -- ── Calories category ───────────────────────────────────────────
      IF v_pack.calories_enabled THEN
        SELECT MAX(calories_count) INTO v_winning_value
          FROM public.daily_scores
          WHERE run_id = v_run.id
            AND score_date = v_current_date
            AND calories_count > 0;
        IF v_winning_value IS NOT NULL AND v_winning_value > 0 THEN
          SELECT ARRAY_AGG(user_id) INTO v_winner_ids
            FROM public.daily_scores
            WHERE run_id = v_run.id
              AND score_date = v_current_date
              AND calories_count = v_winning_value;
          INSERT INTO public.daily_winners
            (pack_id, run_id, score_date, category, winner_user_ids, winning_metric_value)
            VALUES (p_pack_id, v_run.id, v_current_date, 'calories', v_winner_ids, v_winning_value)
            ON CONFLICT (pack_id, score_date, category) DO NOTHING;
        END IF;
      END IF;

      -- ── Water category ──────────────────────────────────────────────
      IF v_pack.water_enabled THEN
        SELECT MAX(water_oz_count) INTO v_winning_value
          FROM public.daily_scores
          WHERE run_id = v_run.id
            AND score_date = v_current_date
            AND water_oz_count > 0;
        IF v_winning_value IS NOT NULL AND v_winning_value > 0 THEN
          SELECT ARRAY_AGG(user_id) INTO v_winner_ids
            FROM public.daily_scores
            WHERE run_id = v_run.id
              AND score_date = v_current_date
              AND water_oz_count = v_winning_value;
          INSERT INTO public.daily_winners
            (pack_id, run_id, score_date, category, winner_user_ids, winning_metric_value)
            VALUES (p_pack_id, v_run.id, v_current_date, 'water', v_winner_ids, v_winning_value)
            ON CONFLICT (pack_id, score_date, category) DO NOTHING;
        END IF;
      END IF;

      -- ── Settle-missing-rows step ────────────────────────────────────
      -- Ensure a daily_scores row exists for every active pack member
      -- for this settled day. Set-based insert (one statement per day,
      -- covering all members) — Postgres handles the per-row conflict
      -- check internally. ON CONFLICT DO NOTHING never clobbers a real
      -- row, including a late HealthKit backfill that arrives AFTER
      -- this settle runs. Generated columns (steps_count,
      -- calories_count, water_oz_count) are deliberately omitted —
      -- Postgres rejects direct writes to GENERATED ALWAYS columns;
      -- the source columns (manual_* and hk_*) are set to 0 and the
      -- generated columns compute as 0.
      --
      -- Reuses the SAME active-member predicate (`is_active = true`)
      -- as the solo-pack guard above. The same predicate the count
      -- guard uses determines who we settle for — keeping the
      -- definition of "active pack member" consistent within this
      -- function.
      INSERT INTO public.daily_scores (
        run_id, user_id, score_date,
        manual_steps_count, manual_calories_count, manual_water_count,
        hk_steps_count, hk_calories_count, hk_water_count, hk_workout_count,
        workout_count, updated_at
      )
      SELECT v_run.id, pm.user_id, v_current_date,
             0, 0, 0,
             0, 0, 0, 0,
             0, now()
      FROM public.pack_members pm
      WHERE pm.pack_id = p_pack_id
        AND pm.is_active = true
      ON CONFLICT (run_id, user_id, score_date) DO NOTHING;
      -- ────────────────────────────────────────────────────────────────

      v_current_date := v_current_date + 1;
    END LOOP;
  END LOOP;
END;
$function$;
