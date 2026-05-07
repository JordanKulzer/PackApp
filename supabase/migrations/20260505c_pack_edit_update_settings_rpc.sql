BEGIN;

-- =========================================================================
-- Pass 20c — Pack Edit feature: update_pack_settings RPC.
--
-- Owner-only RPC for editing pack name + queueing goal-target changes.
-- Goal-target changes go to pending_* columns and apply at the next run
-- rollover (Pass 20b's apply step). Pack name applies immediately.
--
-- Bounds (cross-referenced with client form in app/(app)/pack/edit/[id].tsx
-- — keep in sync if either side changes):
--   step_target:      1000 – 50000
--   calorie_target:    100 – 2000
--   water_target_oz:    16 –  256
--
-- Caller pattern (Pass 20c D-CLIENT-PATTERN B): pass NULL for fields the
-- user didn't change. RPC uses COALESCE to preserve existing pending,
-- so re-edits build on prior pending state (D6) rather than clobbering it.
-- pending_changes_at refreshes only when at least one pending field is
-- actually being set in this call.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.update_pack_settings(
  p_pack_id uuid,
  p_name text,
  p_pending_step_target integer,
  p_pending_calorie_target integer,
  p_pending_water_target_oz integer
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_owner_id uuid;
  v_current_name text;
  v_pack_tz text;
  v_today date;
  v_next_run_start date;
  v_has_pending boolean := false;
  v_final_name text;
BEGIN
  -- ── Auth gate ────────────────────────────────────────────────
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: not authenticated';
  END IF;

  -- ── Fetch + owner check ──────────────────────────────────────
  SELECT created_by, name, timezone
    INTO v_owner_id, v_current_name, v_pack_tz
  FROM packs WHERE id = p_pack_id;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Pack not found';
  END IF;
  IF v_owner_id != v_user_id THEN
    RAISE EXCEPTION 'Unauthorized: not pack owner';
  END IF;

  -- ── Validate bounds (only for non-null inputs) ───────────────
  IF p_pending_step_target IS NOT NULL
     AND (p_pending_step_target < 1000 OR p_pending_step_target > 50000) THEN
    RAISE EXCEPTION 'Invalid step target: must be between 1000 and 50000';
  END IF;
  IF p_pending_calorie_target IS NOT NULL
     AND (p_pending_calorie_target < 100 OR p_pending_calorie_target > 2000) THEN
    RAISE EXCEPTION 'Invalid calorie target: must be between 100 and 2000';
  END IF;
  IF p_pending_water_target_oz IS NOT NULL
     AND (p_pending_water_target_oz < 16 OR p_pending_water_target_oz > 256) THEN
    RAISE EXCEPTION 'Invalid water target: must be between 16 and 256';
  END IF;

  -- ── Name update (immediate; only if changed + non-empty) ─────
  v_final_name := v_current_name;
  IF p_name IS NOT NULL AND length(trim(p_name)) > 0
     AND trim(p_name) != v_current_name THEN
    UPDATE packs SET name = trim(p_name) WHERE id = p_pack_id;
    v_final_name := trim(p_name);
  END IF;

  -- ── Pending updates (queued; applied at rollover by Pass 20b) ─
  -- COALESCE preserves existing pending when caller passes NULL
  -- (= "didn't change this field"). Refresh pending_changes_at
  -- only when at least one field is actually being set in this call.
  IF p_pending_step_target IS NOT NULL
     OR p_pending_calorie_target IS NOT NULL
     OR p_pending_water_target_oz IS NOT NULL THEN
    UPDATE packs
    SET
      pending_step_target     = COALESCE(p_pending_step_target, pending_step_target),
      pending_calorie_target  = COALESCE(p_pending_calorie_target, pending_calorie_target),
      pending_water_target_oz = COALESCE(p_pending_water_target_oz, pending_water_target_oz),
      pending_changes_at      = now()
    WHERE id = p_pack_id;
    v_has_pending := true;
  ELSE
    -- No goal changes this call; check if pending state still exists from
    -- prior edits so the client can render the right post-save UX.
    SELECT pending_changes_at IS NOT NULL INTO v_has_pending
    FROM packs WHERE id = p_pack_id;
  END IF;

  -- ── Compute next run start (Mon→Sun convention, matches rollover_expired_runs)
  v_today := (now() AT TIME ZONE COALESCE(v_pack_tz, 'UTC'))::date;
  v_next_run_start := v_today - ((EXTRACT(ISODOW FROM v_today)::int - 1)) + 7;

  RETURN json_build_object(
    'pack_id', p_pack_id,
    'name', v_final_name,
    'has_pending_changes', v_has_pending,
    'next_run_start', v_next_run_start
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_pack_settings(
  uuid, text, integer, integer, integer
) TO authenticated;

COMMIT;
