-- ============================================================================
-- F.2 — pre-launch test data wipe
--
-- Drops every user-generated row that depends on activity_feed /
-- daily_scores / water_logs / activity_logs so the F.2 migration
-- changes (manual-vs-HK source split, generated steps_count /
-- calories_count, narrowed dedup index) start from a clean slate.
--
-- DESTRUCTIVE. RUN BEFORE LAUNCH ONLY. Wraps in BEGIN/COMMIT so a
-- ROLLBACK is available before commit if the row counts surprise you.
--
-- WHAT IT DOES:
--   1. Deletes children of activity_feed first (feed_comments,
--      activity_reactions, photo_reports — all reference feed rows
--      and would 23503 if not removed first).
--   2. Deletes activity_feed.
--   3. Deletes daily_scores + activity_logs + water_logs (the
--      scoring + manual-log surface).
--   4. Resets daily_winners (derived from daily_scores).
--
-- WHAT IT DOES NOT TOUCH:
--   - users, packs, pack_members, runs (membership + competition
--     structure stays intact so accounts remain usable post-wipe).
--   - chat_messages, push_subscriptions, RC subscription state.
--
-- WHY NO DROP TABLE / TRUNCATE CASCADE: keeps the row deletions
-- visible in pg_stat for post-wipe verification, and avoids
-- accidentally cascading into a table we didn't intend to wipe.
-- ============================================================================

BEGIN;

-- (1) feed_item_id-bearing children of activity_feed. Order doesn't
-- matter among siblings — they're parallel children of activity_feed.
DELETE FROM public.feed_comments;
DELETE FROM public.activity_reactions;
DELETE FROM public.photo_reports;

-- (2) activity_feed itself. Safe now that all children are gone.
DELETE FROM public.activity_feed;

-- (3) Scoring + log surface.
DELETE FROM public.daily_scores;
DELETE FROM public.activity_logs;
DELETE FROM public.water_logs;

-- (4) Derived daily_winners — recomputed from daily_scores on next run.
DELETE FROM public.daily_winners;

-- Sanity check — every wiped table should report zero rows.
SELECT 'activity_feed'      AS table_name, COUNT(*) AS remaining FROM public.activity_feed
UNION ALL SELECT 'feed_comments',          COUNT(*) FROM public.feed_comments
UNION ALL SELECT 'activity_reactions',     COUNT(*) FROM public.activity_reactions
UNION ALL SELECT 'photo_reports',          COUNT(*) FROM public.photo_reports
UNION ALL SELECT 'daily_scores',           COUNT(*) FROM public.daily_scores
UNION ALL SELECT 'activity_logs',          COUNT(*) FROM public.activity_logs
UNION ALL SELECT 'water_logs',             COUNT(*) FROM public.water_logs
UNION ALL SELECT 'daily_winners',          COUNT(*) FROM public.daily_winners;

-- COMMIT;   -- uncomment after reviewing the counts, or ROLLBACK to undo.
