BEGIN;

-- =========================================================================
-- Fix activity_feed_activity_type_check — restore the full union.
--
-- WHY: createSharePost (Intentional-sharing Phase 2) INSERTs fail with
-- Postgres 23514 — activity_type "steps_share" violates the CHECK
-- constraint. Migration 20260510 claimed to add the four _share literals,
-- but the live constraint on this database does not contain them. Either
-- 20260510 was never applied here, was rolled back, or the constraint
-- was hand-edited from an earlier baseline. Run the pg_constraint query
-- in the audit's Task 1 to see the actual live definition.
--
-- Independently, the migration history has a known regression: 20260510
-- rebuilt the CHECK from the 20260429 7-value baseline + 4 share types
-- and SILENTLY DROPPED 'goals_updated' and 'pack_renamed' (added in
-- 20260505 and 20260505d). That means pack-name and goals-targets
-- system messages from Edit Pack have been failing INSERT for the same
-- 23514 reason whenever 20260510 was the active definition.
--
-- WHAT: DROP + ADD the constraint with the COMPLETE union of every
-- value any path in the app might insert:
--
--   - per-activity types         : steps, workout, calories, water
--   - system events              : daily_winner, took_lead, all_goals
--   - pack-management events     : goals_updated, pack_renamed
--   - manual-share variants      : steps_share, workout_share,
--                                  calories_share, water_share
--
-- 13 values total. Order matches the TS union in src/types/database.ts.
--
-- IDEMPOTENT: DROP IF EXISTS + ADD CONSTRAINT runs cleanly regardless
-- of which prior migration was last applied. Safe to re-run; the second
-- run is a no-op (DROP drops, ADD re-adds the identical constraint).
--
-- RE-RUNNABILITY: BEGIN/COMMIT wrap so a partial failure rolls back.
--
-- AFTER APPLYING: re-run the audit's Task 1 query to verify the live
-- definition contains all 13 values. Until this migration applies in
-- the live database, SharePostSheet → createSharePost will continue
-- to fail with 23514.
-- =========================================================================

ALTER TABLE public.activity_feed
  DROP CONSTRAINT IF EXISTS activity_feed_activity_type_check;

ALTER TABLE public.activity_feed
  ADD CONSTRAINT activity_feed_activity_type_check
  CHECK (activity_type = ANY (ARRAY[
    -- per-activity goal-cross + manual log types
    'steps'::text,
    'workout'::text,
    'calories'::text,
    'water'::text,
    -- system / derived events
    'daily_winner'::text,
    'took_lead'::text,
    'all_goals'::text,
    -- pack-management system messages (regression: 20260510 dropped these)
    'goals_updated'::text,
    'pack_renamed'::text,
    -- manual-share variants (Intentional-sharing Phase 2)
    'steps_share'::text,
    'calories_share'::text,
    'water_share'::text,
    'workout_share'::text
  ]));

COMMIT;
