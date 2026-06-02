-- 20260601_rollover_apply_pending_enabled.sql
-- REVIEW-ONLY — Jordan applies in Supabase Studio when ready. Claude has
-- NOT run this against any DB.
--
-- Fixes rollover_expired_runs to apply + clear the four pending category-
-- enabled flags at run rollover. Previously the UPDATE block in the
-- "Pass 20b: apply pending pack-edit changes" section only handled the
-- *_target columns; queued category on/off changes (pending_*_enabled,
-- written by the live 6-arg update_pack_settings) were neither applied to
-- the live *_enabled columns nor cleared, so:
--   • category on/off edits never took effect at rollover (the queued
--     change stayed queued indefinitely), and
--   • the Pack Detail PendingCategoryBanner never auto-cleared, since it
--     reads `pending_*_enabled IS NOT NULL`.
--
-- This migration extends the EXISTING UPDATE block with four
-- COALESCE(pending_*_enabled, *_enabled) applies + the four pending
-- nulls, and broadens the WHERE clause so the UPDATE also fires when
-- only an enabled-pending change is queued (Test24's exact case — its
-- pending_water_enabled is set with no accompanying target change).
--
-- Bug confirmed in Studio 2026-06-01:
--   • Test24: water_enabled = true, pending_water_enabled = false,
--     pending_changes_at = 2026-05-26 (stuck since then through
--     multiple rollovers under the prior buggy function).
--   • Live rollover_expired_runs body shows no *_enabled references in
--     the UPDATE block.
--   • apply_pending_pack_changes_on_rollover does not exist — the fix
--     belongs in rollover_expired_runs's existing UPDATE block.
--
-- Pending-application timing is preserved: the UPDATE only runs when a
-- run has expired (v_active_run.end_date < v_today) — pending changes
-- apply at the NEXT rollover, not immediately. Matches the banner's
-- "next week/month" copy.
--
-- Backfill: NOT included here. Test24's already-stuck pending change
-- will resolve naturally at its next rollover under the fixed function.
-- If the change should be cancelled instead of applied, that's a
-- separate manual update_pack_settings call.
--
-- Base: the live rollover_expired_runs body (the same shape as the
-- prior recorded migration 20260529_rollover_honor_competition_window).
-- Only the UPDATE block's SET list (4 new applies + 4 new nulls) and
-- WHERE clause (4 new IS NOT NULL conditions) changed. CREATE OR
-- REPLACE = idempotent + additive in shape (no existing column or
-- semantic removed). Safe to re-run.

CREATE OR REPLACE FUNCTION public.rollover_expired_runs(caller_user_id uuid)
 RETURNS TABLE(out_pack_id uuid, out_old_run_id uuid, out_new_run_id uuid, out_action text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pack_record RECORD;
  v_active_run RECORD;
  v_pack_tz TEXT;
  v_today DATE;
  v_window_start DATE;
  v_window_end DATE;
  v_existing_run_id UUID;
  v_new_run_id UUID;
  v_closed_run_id UUID;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() != caller_user_id THEN
    RAISE EXCEPTION 'Unauthorized: caller_user_id must match authenticated user';
  END IF;

  FOR v_pack_record IN
    SELECT p.id AS pack_id, p.timezone, p.competition_window
    FROM packs p
    JOIN pack_members pm ON pm.pack_id = p.id
    WHERE pm.user_id = caller_user_id
      AND pm.is_active = true
  LOOP
    v_pack_tz := COALESCE(v_pack_record.timezone, 'UTC');
    v_today := (now() AT TIME ZONE v_pack_tz)::date;

    IF v_pack_record.competition_window = 'monthly' THEN
      v_window_start := date_trunc('month', v_today)::date;
      v_window_end := (date_trunc('month', v_today) + interval '1 month - 1 day')::date;
    ELSE
      v_window_start := v_today - ((EXTRACT(ISODOW FROM v_today)::INT - 1));
      v_window_end := v_window_start + 6;
    END IF;

    SELECT r.id, r.end_date INTO v_active_run
    FROM runs r
    WHERE r.pack_id = v_pack_record.pack_id
      AND r.status = 'active'
    ORDER BY r.created_at DESC
    LIMIT 1;

    v_closed_run_id := NULL;

    IF v_active_run.id IS NOT NULL THEN
      IF v_active_run.end_date < v_today THEN
        UPDATE runs SET status = 'completed' WHERE id = v_active_run.id;
        v_closed_run_id := v_active_run.id;

        PERFORM public.compute_daily_winners_for_pack(v_pack_record.pack_id);

        WITH user_category_counts AS (
          SELECT
            UNNEST(winner_user_ids) AS user_id,
            category,
            COUNT(*) AS days_won
          FROM public.daily_winners
          WHERE run_id = v_closed_run_id
            AND category != 'legacy'
          GROUP BY UNNEST(winner_user_ids), category
        ),
        category_max AS (
          SELECT category, MAX(days_won) AS max_days
          FROM user_category_counts
          GROUP BY category
        )
        INSERT INTO public.run_category_winners
          (run_id, category, winner_user_ids, total_days_won)
        SELECT
          v_closed_run_id,
          ucc.category,
          ARRAY_AGG(ucc.user_id ORDER BY ucc.user_id),
          cm.max_days
        FROM user_category_counts ucc
        JOIN category_max cm ON cm.category = ucc.category
          AND ucc.days_won = cm.max_days
        GROUP BY ucc.category, cm.max_days
        ON CONFLICT (run_id, category) DO NOTHING;
      ELSE
        CONTINUE;
      END IF;
    END IF;

    -- ── Pass 20b: apply pending pack-edit changes ──────────────────────────
    -- Now applies BOTH pending targets AND pending category-enabled flags
    -- (2026-06-01 fix). Previously only the *_target columns were applied/
    -- cleared, so a queued category on/off (pending_*_enabled, written by
    -- update_pack_settings) never executed and the pending banner never
    -- cleared. The WHERE clause now also fires on a pending *_enabled so a
    -- pack with only an enable-change (no target change) still gets applied.
    UPDATE packs
    SET
      step_target              = COALESCE(pending_step_target, step_target),
      calorie_target           = COALESCE(pending_calorie_target, calorie_target),
      water_target_oz          = COALESCE(pending_water_target_oz, water_target_oz),
      steps_enabled            = COALESCE(pending_steps_enabled, steps_enabled),
      workouts_enabled         = COALESCE(pending_workouts_enabled, workouts_enabled),
      calories_enabled         = COALESCE(pending_calories_enabled, calories_enabled),
      water_enabled            = COALESCE(pending_water_enabled, water_enabled),
      pending_step_target      = NULL,
      pending_calorie_target   = NULL,
      pending_water_target_oz  = NULL,
      pending_steps_enabled    = NULL,
      pending_workouts_enabled = NULL,
      pending_calories_enabled = NULL,
      pending_water_enabled    = NULL,
      pending_changes_at       = NULL
    WHERE id = v_pack_record.pack_id
      AND (pending_step_target IS NOT NULL
        OR pending_calorie_target IS NOT NULL
        OR pending_water_target_oz IS NOT NULL
        OR pending_steps_enabled IS NOT NULL
        OR pending_workouts_enabled IS NOT NULL
        OR pending_calories_enabled IS NOT NULL
        OR pending_water_enabled IS NOT NULL);

    SELECT r.id INTO v_existing_run_id
    FROM runs r
    WHERE r.pack_id = v_pack_record.pack_id
      AND r.start_date = v_window_start
      AND r.end_date = v_window_end;

    IF v_existing_run_id IS NOT NULL THEN
      UPDATE runs SET status = 'active'
      WHERE id = v_existing_run_id AND status != 'active';

      out_pack_id := v_pack_record.pack_id;
      out_old_run_id := v_closed_run_id;
      out_new_run_id := v_existing_run_id;
      out_action := 'reactivated_existing';
      RETURN NEXT;
    ELSE
      INSERT INTO runs (pack_id, start_date, end_date, status)
      VALUES (v_pack_record.pack_id, v_window_start, v_window_end, 'active')
      RETURNING id INTO v_new_run_id;

      out_pack_id := v_pack_record.pack_id;
      out_old_run_id := v_closed_run_id;
      out_new_run_id := v_new_run_id;
      out_action := CASE WHEN v_closed_run_id IS NULL THEN 'created_new' ELSE 'rolled_over' END;
      RETURN NEXT;
    END IF;
  END LOOP;

  RETURN;
END;
$function$;
