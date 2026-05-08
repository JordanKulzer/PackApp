BEGIN;

-- =========================================================================
-- Pass 21b — Public user profile RPC.
-- Returns identity + cross-shared-pack stats for a target user, gated
-- server-side by shared-pack membership. Caller can only view profiles
-- of users they share at least one active pack with (or their own).
--
-- Stats are scoped to packs the caller and target both belong to, so the
-- profile reveals nothing about packs the caller can't see.
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
BEGIN
  -- ── Auth gate ──────────────────────────────────────────────────
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: not authenticated';
  END IF;

  -- ── Privacy gate + stats use the same shared-packs set, hoisted
  -- into a CTE-style temp via a single WITH clause for clarity and
  -- to avoid recomputing the JOIN three times.
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
    -- profile/index.tsx:310-317. If the latest log is older than yesterday,
    -- the streak is 0 (the partial-day window excludes stale rows).
    -- NOTE: current_date here is in DB-server timezone (UTC), not pack
    -- timezone — same precision tradeoff as the self-profile JS path.
    -- Tracked for a future broader timezone audit.
    (
      SELECT COALESCE(MAX(ds.streak_days), 0)::int
      FROM daily_scores ds
      JOIN runs r ON r.id = ds.run_id
      WHERE ds.user_id = target_user_id
        AND r.pack_id IN (SELECT pack_id FROM shared_packs)
        AND ds.score_date >= (current_date - interval '1 day')::date
    )
  INTO v_shared_pack_count, v_total_points, v_current_streak;

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
    'total_points_shared', v_total_points,
    'shared_pack_count', v_shared_pack_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_public_profile(uuid) TO authenticated;

COMMIT;
