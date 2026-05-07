BEGIN;

-- =========================================================================
-- Pass 20b — Apply pending pack changes on run rollover.
--
-- When rollover_expired_runs creates or reactivates a run for a pack with
-- pending goal-target changes (set by Pass 20c's update_pack_settings RPC),
-- the pending values become live and the pending state clears — atomically
-- in the same transaction as the new run row.
--
-- The apply step is gated on rollover actually happening for the pack
-- (i.e., not in the early-return CONTINUE path where the active run hasn't
-- expired). A single conditional UPDATE handles the gate via its WHERE
-- clause; if no pending values exist, zero rows are updated.
--
-- Exact existing function body preserved verbatim from
-- pg_get_functiondef('rollover_expired_runs'::regproc); only addition is
-- the new UPDATE block at the documented insertion point.
-- =========================================================================

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
