BEGIN;

-- =========================================================================
-- Pass 18-C.2d Phase 3 — Server-side authority for run-window dates.
-- Two-source-of-truth bug: client weekStartInPackTz/weekEndInPackTz produced
-- Sun→Sat first-runs; rollover_expired_runs produces Mon→Sun. This migration:
--   1. Deletes 4 legacy Sun→Sat runs and their daily_scores (482 pts wiped)
--   2. Drops both overloads of create_pack_with_run
--   3. Recreates create_pack_with_run with server-side Mon→Sun + monthly date math
-- =========================================================================

-- Step 1: Delete legacy daily_scores tied to Sun→Sat runs (FK-first).
DELETE FROM daily_scores
WHERE run_id IN (
  SELECT id FROM runs
  WHERE EXTRACT(ISODOW FROM start_date) = 7
    AND EXTRACT(ISODOW FROM end_date) = 6
);

-- Step 2: Delete the legacy runs themselves.
DELETE FROM runs
WHERE EXTRACT(ISODOW FROM start_date) = 7
  AND EXTRACT(ISODOW FROM end_date) = 6;

-- Step 3: Drop both existing overloads. IF EXISTS allows re-runs.
DROP FUNCTION IF EXISTS public.create_pack_with_run(
  text, text, text, boolean, boolean, boolean, boolean,
  integer, integer, integer, text, text
);

DROP FUNCTION IF EXISTS public.create_pack_with_run(
  text, text, text, text, boolean, boolean, boolean, boolean,
  integer, integer, integer, date, date
);

-- Step 4: Recreate with server-side date computation. Weekly = Mon→Sun
-- (matches rollover_expired_runs). Monthly = first-of-month → last-of-month.
-- Both computed in the pack's timezone so the boundary lands the right day
-- regardless of caller's clock.
CREATE OR REPLACE FUNCTION public.create_pack_with_run(
  pack_name text,
  pack_invite_code text,
  pack_window text,
  pack_timezone text,
  pack_steps_enabled boolean,
  pack_workouts_enabled boolean,
  pack_calories_enabled boolean,
  pack_water_enabled boolean,
  pack_step_target integer,
  pack_calorie_target integer,
  pack_water_target_oz integer
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date;
  v_run_start date;
  v_run_end date;
  v_pack_id uuid;
  v_run_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- Compute "today" in the pack's timezone, then derive run window.
  -- Weekly: Mon → Sun (ISO week, matches rollover_expired_runs convention).
  -- Monthly: first-of-month → last-of-month.
  v_today := (now() AT TIME ZONE pack_timezone)::date;

  IF pack_window = 'monthly' THEN
    v_run_start := date_trunc('month', v_today)::date;
    v_run_end := (date_trunc('month', v_today) + interval '1 month - 1 day')::date;
  ELSE
    v_run_start := v_today - ((EXTRACT(ISODOW FROM v_today)::int - 1));
    v_run_end := v_run_start + 6;
  END IF;

  -- Pack
  INSERT INTO packs (
    name, invite_code, competition_window, timezone,
    steps_enabled, workouts_enabled, calories_enabled, water_enabled,
    step_target, calorie_target, water_target_oz,
    created_by, is_active
  )
  VALUES (
    pack_name, pack_invite_code, pack_window, pack_timezone,
    pack_steps_enabled, pack_workouts_enabled, pack_calories_enabled, pack_water_enabled,
    pack_step_target, pack_calorie_target, pack_water_target_oz,
    auth.uid(), true
  )
  RETURNING id INTO v_pack_id;

  -- Membership
  INSERT INTO pack_members (pack_id, user_id, role, is_active, joined_at)
  VALUES (v_pack_id, auth.uid(), 'admin', true, now());

  -- Run
  INSERT INTO runs (pack_id, start_date, end_date, status)
  VALUES (v_pack_id, v_run_start, v_run_end, 'active')
  RETURNING id INTO v_run_id;

  RETURN json_build_object('pack_id', v_pack_id, 'run_id', v_run_id);
END;
$$;

-- Step 5: Grant EXECUTE to authenticated only (not anon).
GRANT EXECUTE ON FUNCTION public.create_pack_with_run(
  text, text, text, text, boolean, boolean, boolean, boolean,
  integer, integer, integer
) TO authenticated;

COMMIT;
