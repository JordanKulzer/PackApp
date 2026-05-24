BEGIN;

-- =========================================================================
-- Goal-removal Part 1 — drop goal-target params from pack RPCs.
--
-- WHY: The categories pivot replaced goal-hit scoring with per-category
-- daily winners; goals are no longer user-editable in Create / Edit Pack.
-- The two pack RPCs (create_pack_with_run, update_pack_settings) still
-- accepted goal-target params on their signatures. Removing them from the
-- UI requires re-creating the RPCs without those params — PostgREST
-- function lookup is strict on name + arity + arg types, so the UI's new
-- shorter call shape needs a matching DB function.
--
-- WHAT:
--   1. create_pack_with_run — drop pack_step_target / pack_calorie_target /
--      pack_water_target_oz from the signature. The INSERT into packs
--      omits step_target / calorie_target / water_target_oz from the
--      column list entirely — the columns are NOT NULL but have DB
--      DEFAULTs (10000 / 500 / 64), which apply automatically. Run-window
--      computation (Mon→Sun weekly, first→last monthly) unchanged.
--   2. update_pack_settings — drop p_pending_step_target /
--      p_pending_calorie_target / p_pending_water_target_oz from the
--      signature. Drop the pending-target UPDATE block that consumed
--      them. The return shape is also trimmed to { pack_id, name } —
--      has_pending_changes and next_run_start were only ever read by the
--      goal-targets-changed UX (toast + activity-feed caption), which is
--      gone in Part 1's UI changes. The next-run-start computation and
--      pack-timezone read that supported those return fields are dropped
--      with them. Keep: auth gate, owner check, name-update path.
--
-- The pre-existing overloads of these functions must be DROPped first —
-- CREATE OR REPLACE only matches an exact signature; the old longer
-- signatures would otherwise coexist as separate overloads and could be
-- resolved by accident on a future call.
--
-- The goal-target COLUMNS on packs (step_target / calorie_target /
-- water_target_oz / pending_step_target / pending_calorie_target /
-- pending_water_target_oz / pending_changes_at) are deliberately LEFT in
-- place. Several non-UI surfaces still read step_target etc. (sync paths,
-- WeekDetailSheet's X / Y goal display, all_goals event); those are
-- Parts 2 & 3 of this migration plan. Column drops are not in scope.
--
-- RE-RUNNABILITY: DROP FUNCTION IF EXISTS makes the drops idempotent;
-- CREATE OR REPLACE is idempotent. GRANT EXECUTE is harmless to repeat.
-- The file applies cleanly via Supabase SQL editor regardless of whether
-- the prior overloads exist.
-- =========================================================================

-- ── Drop the prior overloads ───────────────────────────────────────────
-- Removing the old longer signatures so the new shorter ones are the
-- only callable overloads after this migration applies.

DROP FUNCTION IF EXISTS public.create_pack_with_run(
  text, text, text, text, boolean, boolean, boolean, boolean,
  integer, integer, integer
);

DROP FUNCTION IF EXISTS public.update_pack_settings(
  uuid, text, integer, integer, integer
);

-- ── create_pack_with_run (no goal targets) ────────────────────────────
-- Identical to the 20260504 definition except:
--   • Signature drops pack_step_target / pack_calorie_target /
--     pack_water_target_oz.
--   • The INSERT into packs omits step_target / calorie_target /
--     water_target_oz from the column list — the columns' DB DEFAULTs
--     apply (10000 / 500 / 64).

CREATE OR REPLACE FUNCTION public.create_pack_with_run(
  pack_name text,
  pack_invite_code text,
  pack_window text,
  pack_timezone text,
  pack_steps_enabled boolean,
  pack_workouts_enabled boolean,
  pack_calories_enabled boolean,
  pack_water_enabled boolean
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

  -- Pack — step_target / calorie_target / water_target_oz omitted; their
  -- column DEFAULTs apply. Other columns unchanged from 20260504.
  INSERT INTO packs (
    name, invite_code, competition_window, timezone,
    steps_enabled, workouts_enabled, calories_enabled, water_enabled,
    created_by, is_active
  )
  VALUES (
    pack_name, pack_invite_code, pack_window, pack_timezone,
    pack_steps_enabled, pack_workouts_enabled, pack_calories_enabled, pack_water_enabled,
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

GRANT EXECUTE ON FUNCTION public.create_pack_with_run(
  text, text, text, text, boolean, boolean, boolean, boolean
) TO authenticated;

-- ── update_pack_settings (no goal targets) ────────────────────────────
-- Identical to the 20260505c definition except:
--   • Signature drops p_pending_step_target / p_pending_calorie_target /
--     p_pending_water_target_oz.
--   • The bounds-validation block is gone (it only validated those 3).
--   • The "Pending updates" UPDATE block is gone — the only path that
--     ever set pending_* columns from this RPC is removed.
--   • Return shape trimmed to { pack_id, name }. The previous
--     has_pending_changes / next_run_start fields existed solely to
--     drive the goal-targets-changed toast + "applies at {date}"
--     caption in the client; both are gone in Part 1.
--   • v_pack_tz / v_today / v_next_run_start / v_has_pending and the
--     SELECTs that fed them are dropped — they only ever served the
--     dropped return fields.
-- Keep: auth gate, owner check, name-update path.

CREATE OR REPLACE FUNCTION public.update_pack_settings(
  p_pack_id uuid,
  p_name text
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
  v_final_name text;
BEGIN
  -- ── Auth gate ────────────────────────────────────────────────
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: not authenticated';
  END IF;

  -- ── Fetch + owner check ──────────────────────────────────────
  SELECT created_by, name
    INTO v_owner_id, v_current_name
  FROM packs WHERE id = p_pack_id;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Pack not found';
  END IF;
  IF v_owner_id != v_user_id THEN
    RAISE EXCEPTION 'Unauthorized: not pack owner';
  END IF;

  -- ── Name update (immediate; only if changed + non-empty) ─────
  v_final_name := v_current_name;
  IF p_name IS NOT NULL AND length(trim(p_name)) > 0
     AND trim(p_name) != v_current_name THEN
    UPDATE packs SET name = trim(p_name) WHERE id = p_pack_id;
    v_final_name := trim(p_name);
  END IF;

  RETURN json_build_object(
    'pack_id', p_pack_id,
    'name', v_final_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_pack_settings(
  uuid, text
) TO authenticated;

COMMIT;
