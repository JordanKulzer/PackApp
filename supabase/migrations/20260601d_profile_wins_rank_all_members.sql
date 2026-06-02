-- 20260601d_profile_wins_rank_all_members.sql
-- REVIEW-ONLY — Jordan applies in Supabase Studio when ready. Claude has
-- NOT run this against any DB.
--
-- Fixes a rank-0 hole introduced by the prior 20260601c migration. That
-- migration built `run_wins` from `daily_winners` only — winners had
-- rows, non-winners didn't. The downstream `ranked_wins` LEFT JOIN's
-- `COALESCE(wins_rank, 0)` then returned 0 for any 0-win member, which
-- the client-side rank guard couldn't distinguish from "no active run."
-- Concretely: in a pack with a leader (3 wins) + two 0-win members,
-- the 0-win members got wins_rank = 0 (invalid ordinal) instead of
-- wins_rank = 2 (real rank behind the leader).
--
-- The fix: `run_wins` now covers ALL active members of each shared pack
-- via a LEFT JOIN onto a new `pack_members_active` CTE + a LATERAL
-- count, COALESCE'd to 0. Every active member gets a row, so the
-- RANK() in `ranked_wins` returns real 1-indexed ordinals across the
-- full roster:
--   • leader (3 wins) → wins_rank 1
--   • 0-win member behind the leader → wins_rank 2 (real ordinal) ✓
--   • fresh week (everyone 0) → all tie at wins_rank 1
--
-- The downstream `ranked_wins` CTE, the four json fields
-- (viewer_wins / target_wins / viewer_wins_rank / target_wins_rank),
-- and the two LEFT JOINs on `ranked_wins` are unchanged — they
-- reference `run_wins`/`ranked_wins` and pick up the fuller ranking
-- automatically.
--
-- Live extensions (today_points / target_rank / target_today_points)
-- and the points CTEs (run_totals / ranked / points fields) all
-- PRESERVED verbatim — this migration only swaps `run_wins`'s shape +
-- adds the supporting `pack_members_active` CTE. CREATE OR REPLACE =
-- idempotent + additive in semantics (no field removed; ranks become
-- more accurate). Safe to re-run.
--
-- After applying, the client (app/user/[id].tsx) needs a small guard
-- tweak to distinguish "fresh week" from "behind a leader":
--   target_wins === 0 && target_wins_rank === 1   → "—"  (no winners yet)
--   else                                          → ordinal(target_wins_rank)
-- That's a separate small client build, not included here.

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
  -- Wins fields from daily_winners over the active run — the live metric.
  -- 2026-06-01 (rank-all-members fix): run_wins now covers ALL active
  -- members (COALESCE wins to 0) so a 0-win member behind a leader gets a
  -- real rank (e.g. #2) instead of 0. Fresh week → everyone ties at rank 1.
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
  -- All active members of each shared pack — so 0-win members are ranked too.
  pack_members_active AS (
    SELECT pm.pack_id, pm.user_id
    FROM pack_members pm
    WHERE pm.is_active = true
      AND pm.pack_id IN (SELECT pack_id FROM shared_packs)
  ),
  -- Per-member WINS over the active run, COALESCE'd to 0 for non-winners
  -- (count of category-day wins from daily_winners, excluding legacy —
  -- mirrors rollover_expired_runs + usePackCategoryStandings). Covering all
  -- members (not just winners) is what gives a 0-win member a real rank.
  run_wins AS (
    SELECT pma.pack_id, pma.user_id,
           COALESCE(w.wins, 0)::int AS wins
    FROM pack_members_active pma
    LEFT JOIN active_runs ar ON ar.pack_id = pma.pack_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS wins
      FROM public.daily_winners dw
      CROSS JOIN LATERAL UNNEST(dw.winner_user_ids) AS u(user_id)
      WHERE dw.run_id = ar.run_id
        AND dw.category != 'legacy'
        AND u.user_id = pma.user_id
    ) w ON true
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
      'viewer_wins', COALESCE(viewer_w.wins, 0),
      'target_wins', COALESCE(target_w.wins, 0),
      'viewer_wins_rank', COALESCE(viewer_w.wins_rank, 0),
      'target_wins_rank', COALESCE(target_w.wins_rank, 0),
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
  LEFT JOIN ranked_wins viewer_w ON viewer_w.pack_id = sp.pack_id AND viewer_w.user_id = v_caller
  LEFT JOIN ranked_wins target_w ON target_w.pack_id = sp.pack_id AND target_w.user_id = target_user_id
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
