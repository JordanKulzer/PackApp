-- supabase/migrations/20260520_categories_pivot_stage3a.sql
--
-- Categories Pivot — Stage 3a: aggregate run_category_winners on run close.
--
-- Extends rollover_expired_runs so that when a run is closed (status →
-- 'completed'), the pack's per-category daily winners are tallied into
-- run_category_winners as a settled, end-of-run record.
--
-- New logic added inside the run-close branch (right after the run is
-- marked completed and v_closed_run_id is set):
--   1. PERFORM compute_daily_winners_for_pack — ensures the run's final
--      day has daily_winners rows before aggregation. The daily-winners
--      RPC computes through "yesterday", so the last day of a just-closed
--      run may not have been captured yet. Running it here makes the
--      capture atomic with the run close (same transaction).
--   2. Aggregate daily_winners for the closed run into per-category
--      wins-counts and INSERT the leader(s) of each category into
--      run_category_winners.
--
-- Base function body: rollover_expired_runs is ALREADY in migration
-- history — defined by 20260505b_apply_pending_pack_changes_on_rollover.sql.
-- (The brief described it as out-of-band with no migration file; that is
-- not the case — see the note in the accompanying report.) This migration
-- reproduces the 20260505b body verbatim and adds ONLY the new aggregation
-- block; no other line changes.
--
-- Re-runnable: CREATE OR REPLACE FUNCTION is naturally idempotent; the
-- run_category_winners INSERT uses ON CONFLICT (run_id, category) DO
-- NOTHING so re-closing a run (or re-running this migration) cannot
-- duplicate rows.

BEGIN;

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
  v_week_start DATE;
  v_week_end DATE;
  v_existing_run_id UUID;
  v_new_run_id UUID;
  v_closed_run_id UUID;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() != caller_user_id THEN
    RAISE EXCEPTION 'Unauthorized: caller_user_id must match authenticated user';
  END IF;

  FOR v_pack_record IN
    SELECT p.id AS pack_id, p.timezone
    FROM packs p
    JOIN pack_members pm ON pm.pack_id = p.id
    WHERE pm.user_id = caller_user_id
      AND pm.is_active = true
  LOOP
    v_pack_tz := COALESCE(v_pack_record.timezone, 'UTC');
    v_today := (now() AT TIME ZONE v_pack_tz)::date;
    v_week_start := v_today - ((EXTRACT(ISODOW FROM v_today)::INT - 1));
    v_week_end := v_week_start + 6;

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

        -- ── Categories Pivot Stage 3a: aggregate run_category_winners ──
        -- The closing run becomes a settled record. Compute the latest
        -- daily_winners first (to capture the final day, which might not
        -- have been computed yet), then aggregate per-category wins counts.
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
    -- Reaching this point means rollover is happening for this pack —
    -- either a new run will be inserted (created_new / rolled_over) or an
    -- existing current-week row will be reactivated (reactivated_existing).
    -- All three are run-becoming-active moments, so apply pending in all
    -- three. The WHERE clause filters out packs with no pending state, so
    -- zero-pending packs see no row mutation (no realtime/audit noise).
    UPDATE packs
    SET
      step_target             = COALESCE(pending_step_target, step_target),
      calorie_target          = COALESCE(pending_calorie_target, calorie_target),
      water_target_oz         = COALESCE(pending_water_target_oz, water_target_oz),
      pending_step_target     = NULL,
      pending_calorie_target  = NULL,
      pending_water_target_oz = NULL,
      pending_changes_at      = NULL
    WHERE id = v_pack_record.pack_id
      AND (pending_step_target IS NOT NULL
        OR pending_calorie_target IS NOT NULL
        OR pending_water_target_oz IS NOT NULL);

    SELECT r.id INTO v_existing_run_id
    FROM runs r
    WHERE r.pack_id = v_pack_record.pack_id
      AND r.start_date = v_week_start
      AND r.end_date = v_week_end;

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
      VALUES (v_pack_record.pack_id, v_week_start, v_week_end, 'active')
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

COMMIT;
