-- ============================================================================
-- Phase C.5 — HealthKit duplicate-emission cleanup
--
-- WORKFLOW:
--   1. Apply migration 20260428a_dedup_pre_cleanup.sql (score_date backfill +
--      healthkit_uuid column).
--   2. Run the PREVIEW section below. Confirm the counts look reasonable.
--   3. Wrap the APPLY section in BEGIN; … COMMIT/ROLLBACK and run it.
--   4. Apply migration 20260428b_dedup_post_cleanup.sql (unique constraints).
--
-- WHAT THIS DOES:
--   - For (steps, calories, water): keeps the OLDEST row per
--     (user_id, pack_id, activity_type, score_date), deletes the rest.
--   - For workouts: keeps the first 2 per (user_id, pack_id, score_date) per
--     scoring rules. Currently expected to be a no-op (no workout dups today).
--   - Resets daily_scores rows for affected (user, score_date, pack-run)
--     tuples to baseline. The next sync repopulates via the existing
--     recompute-style upsert.
--
-- WHAT THIS DOES NOT TOUCH:
--   - reactions / comments on dup feed rows (FK CASCADE drops them with the
--     row; in this dataset there are none expected on the dup rows).
--   - daily_scores for unaffected (user, score_date) tuples.
--   - daily_scores.streak_days / streak_multiplier on adjacent days — these
--     get recomputed by computeStreakForRun on next sync.
-- ============================================================================

-- ============================================================================
-- PREVIEW (read-only — run first)
-- ============================================================================

-- 1. How many rows will be deleted from steps/calories/water dedup?
SELECT activity_type,
       COUNT(*) - COUNT(DISTINCT (user_id, pack_id, score_date)) AS rows_to_delete
FROM activity_feed
WHERE activity_type IN ('steps', 'calories', 'water')
GROUP BY activity_type
ORDER BY activity_type;

-- 2. Per-tuple breakdown (sanity check the worst offenders)
SELECT user_id, pack_id, activity_type, score_date, COUNT(*) AS row_count
FROM activity_feed
WHERE activity_type IN ('steps', 'calories', 'water')
GROUP BY user_id, pack_id, activity_type, score_date
HAVING COUNT(*) > 1
ORDER BY row_count DESC
LIMIT 20;

-- 3. Workout dup count (should be 0 today)
SELECT user_id, pack_id, score_date, COUNT(*) AS workout_rows
FROM activity_feed
WHERE activity_type = 'workout'
GROUP BY user_id, pack_id, score_date
HAVING COUNT(*) > 2
ORDER BY workout_rows DESC
LIMIT 20;

-- 4. How many daily_scores rows will be reset?
SELECT COUNT(DISTINCT (ds.user_id, ds.score_date, ds.run_id)) AS rows_to_reset
FROM daily_scores ds
JOIN runs r ON r.id = ds.run_id
WHERE (ds.user_id, r.pack_id, ds.score_date) IN (
  SELECT user_id, pack_id, score_date
  FROM (
    SELECT user_id, pack_id, score_date, COUNT(*) AS cnt
    FROM activity_feed
    WHERE activity_type IN ('steps', 'calories', 'water')
    GROUP BY user_id, pack_id, score_date, activity_type
    HAVING COUNT(*) > 1
    UNION ALL
    SELECT user_id, pack_id, score_date, COUNT(*)
    FROM activity_feed
    WHERE activity_type = 'workout'
    GROUP BY user_id, pack_id, score_date
    HAVING COUNT(*) > 2
  ) sub
);

-- ============================================================================
-- APPLY (destructive — wrap in BEGIN/COMMIT to allow rollback)
-- ============================================================================
-- BEGIN;

-- (a) Snapshot the affected (user, pack, score_date) tuples BEFORE deleting
-- so we can reset the corresponding daily_scores rows afterwards.
CREATE TEMP TABLE affected_user_pack_days AS
SELECT DISTINCT user_id, pack_id, score_date FROM (
  SELECT user_id, pack_id, score_date, activity_type, COUNT(*) AS cnt
  FROM activity_feed
  WHERE activity_type IN ('steps', 'calories', 'water')
  GROUP BY user_id, pack_id, score_date, activity_type
  HAVING COUNT(*) > 1
  UNION ALL
  SELECT user_id, pack_id, score_date, 'workout', COUNT(*)
  FROM activity_feed
  WHERE activity_type = 'workout'
  GROUP BY user_id, pack_id, score_date
  HAVING COUNT(*) > 2
) sub;

-- (b) Delete dups for steps/calories/water. Keeps oldest row per tuple.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY user_id, pack_id, activity_type, score_date
    ORDER BY created_at ASC
  ) AS rn
  FROM activity_feed
  WHERE activity_type IN ('steps', 'calories', 'water')
)
DELETE FROM activity_feed
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- (c) Delete dups for workouts. Keeps first 2 rows per (user, pack, day).
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY user_id, pack_id, score_date
    ORDER BY created_at ASC
  ) AS rn
  FROM activity_feed
  WHERE activity_type = 'workout'
)
DELETE FROM activity_feed
WHERE id IN (SELECT id FROM ranked WHERE rn > 2);

-- (d) Reset daily_scores rows for affected (user, run, score_date) tuples.
-- Filtered by run.pack_id to avoid touching unrelated packs' scoring.
-- F.2: steps_count / calories_count are now DB-generated as
-- (manual_*_count + hk_*_count); zeroing them happens implicitly when
-- both source-columns are zeroed. has_manual_* booleans were dropped
-- in migration 20260513b — M badge derives from manual_*_count > 0
-- going forward.
UPDATE daily_scores ds
SET total_points = 0,
    streak_days = 0,
    streak_multiplier = 1,
    steps_achieved = false,
    workout_achieved = false,
    calories_achieved = false,
    water_achieved = false,
    manual_steps_count = 0,
    manual_calories_count = 0,
    water_oz_count = 0,
    workout_count = 0,
    hk_steps_count = 0,
    hk_calories_count = 0,
    hk_workout_count = 0,
    updated_at = NOW()
FROM affected_user_pack_days a
JOIN runs r ON r.pack_id = a.pack_id
WHERE ds.run_id = r.id
  AND ds.user_id = a.user_id
  AND ds.score_date = a.score_date;

-- (e) Confirm: should return 0 dup-tuples remaining.
SELECT 'remaining_dups_check' AS check_name,
       (SELECT COUNT(*) FROM (
          SELECT 1 FROM activity_feed
          WHERE activity_type IN ('steps', 'calories', 'water')
          GROUP BY user_id, pack_id, activity_type, score_date
          HAVING COUNT(*) > 1
        ) sub) AS goal_dups,
       (SELECT COUNT(*) FROM (
          SELECT 1 FROM activity_feed
          WHERE activity_type = 'workout'
          GROUP BY user_id, pack_id, score_date
          HAVING COUNT(*) > 2
        ) sub) AS workout_dups;

-- COMMIT;  -- run after reviewing above output, or ROLLBACK to undo.
