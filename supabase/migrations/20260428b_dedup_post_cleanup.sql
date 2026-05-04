-- Phase C.5 — HealthKit duplicate-emission fix, part 2 of 2 (POST-cleanup)
--
-- Apply ONLY after scripts/cleanup_dup_feed.sql has been run successfully
-- and the dup checks at the bottom of that script returned 0/0.
--
-- These unique indexes will fail with a constraint-violation error if any
-- duplicate rows still exist. That's intentional — refuse to apply the
-- guard until the data is clean.
--
-- ── Goal-completion uniqueness (steps / calories / water) ───────────────────
-- One row per user per pack per type per day. score_date is populated on
-- new rows by the application code (after this migration ships); legacy
-- rows were backfilled by 20260428a.
--
-- Note: took_lead and all_goals are NOT in this index because the schema's
-- activity_type CHECK constraint currently rejects those values, so they
-- never reach the table. Flagged separately — see the implementation
-- summary.

CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_feed_no_dup_goals
  ON activity_feed (user_id, pack_id, activity_type, score_date)
  WHERE activity_type IN ('steps', 'calories', 'water');

-- ── HealthKit workout per-sample uniqueness ─────────────────────────────────
-- One feed row per (user, healthkit_uuid). Manual workouts have NULL UUID
-- and bypass the constraint. Same HK workout sample resyncing → no-op.

CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_feed_no_dup_hk_workouts
  ON activity_feed (user_id, healthkit_uuid)
  WHERE activity_type = 'workout' AND healthkit_uuid IS NOT NULL;
