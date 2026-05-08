BEGIN;

-- =========================================================================
-- Pass 21c — Extend get_user_public_profile with best-streak + 4 fitness
-- totals across shared packs. Same signature, same privacy gate. Adds:
--   - best_streak (int)        MAX(streak_days) across shared packs, no
--                              recency window
--   - total_steps (int)        SUM(steps_count) across shared packs
--   - total_workouts (int)     SUM(workout_count) across shared packs
--   - total_calories (int)     SUM(calories_count) across shared packs
--   - total_water_oz (int)     SUM(water_oz_count) across shared packs
--
-- All five aggregations route through the existing shared_packs CTE — no
-- privacy boundary changes. total_points_shared retained in the return
-- shape for backward compat with older clients during rollout (the screen
-- no longer renders it; voice review may reuse later).
-- =========================================================================

CREATE OR REPLACE FUNCTION public.get_user_public_profile(
  target_user_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_user record;
  v_shared_pack_count int := 0;
  v_total_points int := 0;
  v_current_streak int := 0;
  v_best_streak int := 0;
  v_total_steps int := 0;
  v_total_workouts int := 0;
  v_total_calories int := 0;
  v_total_water_oz int := 0;
BEGIN
  -- ── Auth gate ──────────────────────────────────────────────────
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: not authenticated';
  END IF;

  -- ── Privacy gate + stats use the same shared-packs set, hoisted
  -- into a CTE-style temp via a single WITH clause. Keep 5 separate
  -- subqueries for readability; collapse-to-one optimization deferred
  -- to telemetry-driven necessity (per Pass 21c audit).
  WITH shared_packs AS (
    SELECT DISTINCT pm1.pack_id
    FROM pack_members pm1
    JOIN pack_members pm2 ON pm1.pack_id = pm2.pack_id
    WHERE pm1.user_id = v_caller
      AND pm2.user_id = target_user_id
      AND pm1.is_active = true
      AND pm2.is_active = true
  )
  SELECT
    (SELECT count(*) FROM shared_packs),
    (
      SELECT COALESCE(SUM(ds.total_points), 0)::int
      FROM daily_scores ds
      JOIN runs r ON r.id = ds.run_id
      WHERE ds.user_id = target_user_id
        AND r.pack_id IN (SELECT pack_id FROM shared_packs)
    ),
    -- Current streak: max streak_days from rows logged today or yesterday
    -- across shared packs. Mirrors self-profile's "isRecent" check at
    -- profile/index.tsx:310-317. NOTE: current_date is in DB-server
    -- timezone (UTC), not pack timezone — same precision tradeoff as the
    -- self-profile JS path. Tracked for a future broader timezone audit.
    (
      SELECT COALESCE(MAX(ds.streak_days), 0)::int
      FROM daily_scores ds
      JOIN runs r ON r.id = ds.run_id
      WHERE ds.user_id = target_user_id
        AND r.pack_id IN (SELECT pack_id FROM shared_packs)
        AND ds.score_date >= (current_date - interval '1 day')::date
    ),
    -- Best streak: max streak_days across all history (no recency gate).
    -- A user with current=0 and best=12 means they had a 12-day run at
    -- some point but the latest log is older than yesterday.
    (
      SELECT COALESCE(MAX(ds.streak_days), 0)::int
      FROM daily_scores ds
      JOIN runs r ON r.id = ds.run_id
      WHERE ds.user_id = target_user_id
        AND r.pack_id IN (SELECT pack_id FROM shared_packs)
    ),
    -- Fitness totals across shared packs.
    (
      SELECT COALESCE(SUM(ds.steps_count), 0)::int
      FROM daily_scores ds
      JOIN runs r ON r.id = ds.run_id
      WHERE ds.user_id = target_user_id
        AND r.pack_id IN (SELECT pack_id FROM shared_packs)
    ),
    (
      SELECT COALESCE(SUM(ds.workout_count), 0)::int
      FROM daily_scores ds
      JOIN runs r ON r.id = ds.run_id
      WHERE ds.user_id = target_user_id
        AND r.pack_id IN (SELECT pack_id FROM shared_packs)
    ),
    (
      SELECT COALESCE(SUM(ds.calories_count), 0)::int
      FROM daily_scores ds
      JOIN runs r ON r.id = ds.run_id
      WHERE ds.user_id = target_user_id
        AND r.pack_id IN (SELECT pack_id FROM shared_packs)
    ),
    (
      SELECT COALESCE(SUM(ds.water_oz_count), 0)::int
      FROM daily_scores ds
      JOIN runs r ON r.id = ds.run_id
      WHERE ds.user_id = target_user_id
        AND r.pack_id IN (SELECT pack_id FROM shared_packs)
    )
  INTO
    v_shared_pack_count,
    v_total_points,
    v_current_streak,
    v_best_streak,
    v_total_steps,
    v_total_workouts,
    v_total_calories,
    v_total_water_oz;

  IF v_shared_pack_count = 0 AND target_user_id != v_caller THEN
    RAISE EXCEPTION 'Profile not visible: no shared packs';
  END IF;

  -- ── Identity ───────────────────────────────────────────────────
  SELECT id, display_name, avatar_url, created_at
    INTO v_user
  FROM users
  WHERE id = target_user_id;

  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  RETURN json_build_object(
    'user_id', v_user.id,
    'display_name', v_user.display_name,
    'avatar_url', v_user.avatar_url,
    'created_at', v_user.created_at,
    'current_streak', v_current_streak,
    'best_streak', v_best_streak,
    'total_points_shared', v_total_points,
    'shared_pack_count', v_shared_pack_count,
    'total_steps', v_total_steps,
    'total_workouts', v_total_workouts,
    'total_calories', v_total_calories,
    'total_water_oz', v_total_water_oz
  );
END;
$$;

-- Defensive GRANT — Pass 21b's grant survives CREATE OR REPLACE, but this
-- makes the migration self-contained against future drop+recreate.
GRANT EXECUTE ON FUNCTION public.get_user_public_profile(uuid) TO authenticated;

COMMIT;
