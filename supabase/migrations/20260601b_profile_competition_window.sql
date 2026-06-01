-- 20260601b_profile_competition_window.sql
-- REVIEW-ONLY — Jordan applies in Supabase Studio when ready. Claude has
-- NOT run this against any DB.
--
-- Adds `competition_window` to each shared_packs_detail row returned by
-- get_user_public_profile so the profile screen's pack-context summary
-- block can label its run-total stat as "This week" vs "This month"
-- without a second client RPC roundtrip. One additional field in the
-- existing json_build_object — `p.competition_window` is already in
-- scope (packs `p` is already joined in the per-pack head-to-head CTE
-- chain). Purely additive: no existing returned fields changed.
--
-- Until applied, the client falls back to "This week" via the ternary's
-- else branch (CompetitionWindow is "weekly" | "monthly"; anything not
-- strictly === "monthly" → "This week"). Applying this migration makes
-- the label correct for monthly packs.
--
-- Base: 20260601_profile_target_rank_today_points.sql (the recorded
-- live function as of 2026-06-01). Single delta is the new
-- 'competition_window' field in the json_build_object.

CREATE OR REPLACE FUNCTION public.get_user_public_profile(target_user_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_shared_packs_detail json := '[]'::json;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: not authenticated';
  END IF;

  -- ── Shared-packs-scoped aggregations (UNCHANGED) ──────────────
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
    (SELECT COALESCE(SUM(ds.total_points), 0)::int FROM daily_scores ds
       JOIN runs r ON r.id = ds.run_id
       WHERE ds.user_id = target_user_id AND r.pack_id IN (SELECT pack_id FROM shared_packs)),
    (SELECT COALESCE(SUM(ds.steps_count), 0)::int FROM daily_scores ds
       JOIN runs r ON r.id = ds.run_id
       WHERE ds.user_id = target_user_id AND r.pack_id IN (SELECT pack_id FROM shared_packs)),
    (SELECT COALESCE(SUM(ds.workout_count), 0)::int FROM daily_scores ds
       JOIN runs r ON r.id = ds.run_id
       WHERE ds.user_id = target_user_id AND r.pack_id IN (SELECT pack_id FROM shared_packs)),
    (SELECT COALESCE(SUM(ds.calories_count), 0)::int FROM daily_scores ds
       JOIN runs r ON r.id = ds.run_id
       WHERE ds.user_id = target_user_id AND r.pack_id IN (SELECT pack_id FROM shared_packs)),
    (SELECT COALESCE(SUM(ds.water_oz_count), 0)::int FROM daily_scores ds
       JOIN runs r ON r.id = ds.run_id
       WHERE ds.user_id = target_user_id AND r.pack_id IN (SELECT pack_id FROM shared_packs))
  INTO
    v_shared_pack_count, v_total_points, v_total_steps,
    v_total_workouts, v_total_calories, v_total_water_oz;

  -- ── Global streak (UNCHANGED) ─────────────────────────────────
  SELECT COALESCE(current_streak, 0)::int INTO v_current_streak FROM users WHERE id = target_user_id;
  SELECT COALESCE(best_streak, 0)::int INTO v_best_streak FROM users WHERE id = target_user_id;

  IF v_shared_pack_count = 0 AND target_user_id != v_caller THEN
    RAISE EXCEPTION 'Profile not visible: no shared packs';
  END IF;

  -- ── Per-pack head-to-head detail ──────────────────────────────
  -- DELTA from 20260601: one additional field in the json_build_object —
  -- `'competition_window', p.competition_window`. `p` is the packs row
  -- already joined (was already supplying pack_name); no new joins, no
  -- new CTEs.
  WITH shared_packs AS (
    SELECT DISTINCT pm1.pack_id
    FROM pack_members pm1
    JOIN pack_members pm2 ON pm1.pack_id = pm2.pack_id
    WHERE pm1.user_id = v_caller
      AND pm2.user_id = target_user_id
      AND pm1.is_active = true
      AND pm2.is_active = true
  ),
  active_runs AS (
    SELECT id AS run_id, pack_id
    FROM runs
    WHERE status = 'active'
      AND pack_id IN (SELECT pack_id FROM shared_packs)
  ),
  run_totals AS (
    SELECT ar.pack_id, ds.user_id, SUM(ds.total_points)::int AS run_points
    FROM daily_scores ds
    JOIN active_runs ar ON ar.run_id = ds.run_id
    GROUP BY ar.pack_id, ds.user_id
  ),
  ranked AS (
    SELECT pack_id, user_id, run_points,
           RANK() OVER (PARTITION BY pack_id ORDER BY run_points DESC)::int AS rank
    FROM run_totals
  ),
  member_counts AS (
    SELECT pm.pack_id, COUNT(*)::int AS member_count
    FROM pack_members pm
    WHERE pm.is_active = true
      AND pm.pack_id IN (SELECT pack_id FROM shared_packs)
    GROUP BY pm.pack_id
  ),
  today_points AS (
    SELECT ar.pack_id,
           COALESCE(SUM(ds.total_points), 0)::int AS pts
    FROM active_runs ar
    JOIN packs p ON p.id = ar.pack_id
    LEFT JOIN daily_scores ds
      ON ds.run_id = ar.run_id
     AND ds.user_id = target_user_id
     AND ds.score_date = (now() AT TIME ZONE COALESCE(p.timezone, 'UTC'))::date
    GROUP BY ar.pack_id
  )
  SELECT COALESCE(json_agg(
    json_build_object(
      'pack_id', p.id,
      'pack_name', p.name,
      'competition_window', p.competition_window,      -- NEW
      'has_active_run', (ar.run_id IS NOT NULL),
      'viewer_points', COALESCE(viewer.run_points, 0),
      'target_points', COALESCE(target.run_points, 0),
      'viewer_rank', COALESCE(viewer.rank, 0),
      'target_rank', COALESCE(target.rank, 0),
      'target_today_points', COALESCE(tp.pts, 0),
      'member_count', COALESCE(mc.member_count, 0)
    )
    ORDER BY p.name
  ), '[]'::json)
  INTO v_shared_packs_detail
  FROM (SELECT pack_id FROM shared_packs) sp
  JOIN packs p ON p.id = sp.pack_id
  LEFT JOIN active_runs ar ON ar.pack_id = sp.pack_id
  LEFT JOIN ranked viewer ON viewer.pack_id = sp.pack_id AND viewer.user_id = v_caller
  LEFT JOIN ranked target ON target.pack_id = sp.pack_id AND target.user_id = target_user_id
  LEFT JOIN member_counts mc ON mc.pack_id = sp.pack_id
  LEFT JOIN today_points tp ON tp.pack_id = sp.pack_id;

  -- ── Identity (UNCHANGED) ───────────────────────────────────────
  SELECT id, display_name, avatar_url, created_at INTO v_user FROM users WHERE id = target_user_id;
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
    'total_water_oz', v_total_water_oz,
    'shared_packs_detail', v_shared_packs_detail
  );
END;
$function$;
