-- 20260601c_profile_wins_fields.sql
-- REVIEW-ONLY — Jordan applies in Supabase Studio when ready. Claude has
-- NOT run this against any DB.
--
-- Adds wins-based fields to each shared_packs_detail row returned by
-- get_user_public_profile so the profile sheet's "this week" block + the
-- Shared-packs head-to-head delta can read the LIVE metric (category-day
-- wins from daily_winners) instead of the dead daily_scores.total_points
-- column. Per the audit:
--   • daily_scores.total_points has no writer in the current code path —
--     Categories Pivot Stage 2A removed the scoring helpers + streak
--     multipliers (src/lib/scoring.ts:41-44 documents the removal).
--   • Column is NOT NULL DEFAULT 0; never updated → always 0.
--   • Profile sheet renders "0 pts" + rank "—" for a user the rest of
--     the app correctly shows as 1st with 3 wins.
--   • Standings/Compete/History/Crown read wins from daily_winners via
--     usePackCategoryStandings; this RPC will now expose the same metric.
--
-- The live function body has a LIVE-ONLY extension that the repo doesn't
-- record fully (today_points CTE + target_rank + target_today_points
-- fields). This migration PRESERVES that extension verbatim and ADDS only
-- the wins fields/CTEs alongside it. Existing points fields/CTEs stay
-- (target_points, viewer_points, target_rank, viewer_rank) until the
-- points→wins sweep removes the dead readers in a later turn.
--
-- ADD-ONLY summary:
--   1. New CTE `run_wins`: per pack+user, COUNT(*) of category-day wins
--      from daily_winners over the active run, excluding 'legacy' rows
--      (mirrors rollover_expired_runs's 'AND category != legacy' guard
--      + usePackCategoryStandings's tally semantics).
--   2. New CTE `ranked_wins`: RANK() OVER (PARTITION BY pack_id ORDER
--      BY wins DESC) — the wins-based rank.
--   3. Four new json_build fields per shared_packs_detail row:
--      viewer_wins, target_wins, viewer_wins_rank, target_wins_rank.
--   4. Two new LEFT JOINs (viewer_w / target_w on ranked_wins).
--
-- Everything else (points CTEs, today_points, streak, lifetime, identity,
-- return shape) byte-identical to the live function body. CREATE OR
-- REPLACE = idempotent + additive (no existing field removed). Safe to
-- re-run.
--
-- UNNEST form used: `CROSS JOIN LATERAL UNNEST(winner_user_ids) AS
-- w(user_id)`. Functionally identical to the live rollover_expired_runs's
-- `SELECT UNNEST(...) AS user_id, ...` form — both produce one row per
-- (winner_row × user in the array), counted per user via GROUP BY.

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

  -- ── Per-pack head-to-head detail (EXTENDED) ───────────────────
  -- Live extension (today_points/target_rank/target_today_points) PRESERVED.
  -- 2026-06-01 ADD: wins-based fields (run_wins/ranked_wins +
  -- target_wins/viewer_wins/target_wins_rank/viewer_wins_rank) from
  -- daily_winners over the active run — the live metric. Points CTEs kept
  -- until the points→wins sweep removes the dead readers.
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
  -- NEW: per-user WINS over the active run (count of category-day wins from
  -- daily_winners, excluding legacy rows — mirrors rollover_expired_runs +
  -- usePackCategoryStandings). This is the LIVE metric the rest of the app
  -- shows.
  run_wins AS (
    SELECT ar.pack_id, w.user_id, COUNT(*)::int AS wins
    FROM active_runs ar
    JOIN public.daily_winners dw ON dw.run_id = ar.run_id
    CROSS JOIN LATERAL UNNEST(dw.winner_user_ids) AS w(user_id)
    WHERE dw.category != 'legacy'
    GROUP BY ar.pack_id, w.user_id
  ),
  ranked_wins AS (
    SELECT pack_id, user_id, wins,
           RANK() OVER (PARTITION BY pack_id ORDER BY wins DESC)::int AS wins_rank
    FROM run_wins
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
      'has_active_run', (ar.run_id IS NOT NULL),
      'viewer_points', COALESCE(viewer.run_points, 0),
      'target_points', COALESCE(target.run_points, 0),
      'viewer_rank', COALESCE(viewer.rank, 0),
      'target_rank', COALESCE(target.rank, 0),
      'target_today_points', COALESCE(tp.pts, 0),
      'viewer_wins', COALESCE(viewer_w.wins, 0),            -- NEW
      'target_wins', COALESCE(target_w.wins, 0),            -- NEW
      'viewer_wins_rank', COALESCE(viewer_w.wins_rank, 0),  -- NEW
      'target_wins_rank', COALESCE(target_w.wins_rank, 0),  -- NEW
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
  LEFT JOIN ranked_wins viewer_w ON viewer_w.pack_id = sp.pack_id AND viewer_w.user_id = v_caller          -- NEW
  LEFT JOIN ranked_wins target_w ON target_w.pack_id = sp.pack_id AND target_w.user_id = target_user_id    -- NEW
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
