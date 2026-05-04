-- Phase C.5 — HealthKit duplicate-emission fix, part 1 of 2 (PRE-cleanup)
--
-- Order of operations:
--   1. Apply this migration (backfill score_date, add healthkit_uuid + non-unique index)
--   2. Run scripts/cleanup_dup_feed.sql (preview → DELETE dups → reset daily_scores)
--   3. Apply 20260428b_dedup_post_cleanup.sql (the actual unique constraints)
--
-- The unique constraints are split into part 2 because they fail if
-- duplicates still exist. We need to clean the data first.

-- ── 1. Backfill score_date for legacy rows ──────────────────────────────────
-- Use the pack's timezone so the date matches what the app considers "today
-- in this pack." Existing app code computes score_date the same way for
-- daily_scores writes; we mirror that for activity_feed.
UPDATE activity_feed af
SET score_date = (af.created_at AT TIME ZONE p.timezone)::date
FROM packs p
WHERE af.pack_id = p.id
  AND af.score_date IS NULL;

-- ── 2. Add healthkit_uuid column for workout per-sample dedup ───────────────
-- Nullable: manual workouts and existing rows have NULL. The post-cleanup
-- partial unique index only enforces uniqueness on rows where this is NOT NULL.
ALTER TABLE activity_feed
  ADD COLUMN IF NOT EXISTS healthkit_uuid text;

CREATE INDEX IF NOT EXISTS idx_activity_feed_healthkit_uuid
  ON activity_feed (healthkit_uuid)
  WHERE healthkit_uuid IS NOT NULL;
