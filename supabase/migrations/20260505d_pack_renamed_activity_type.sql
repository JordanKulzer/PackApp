BEGIN;

-- =========================================================================
-- Pass 20e — Add 'pack_renamed' activity_type for the rename system message.
-- Mirrors the Pass 20a pattern for 'goals_updated': extend the CHECK
-- constraint and the partial unique index. No new columns. The new pack
-- name is stored in the existing `caption` column at insert time so each
-- historical rename row preserves its own newName (vs a live join, which
-- would mutate old messages whenever the pack is renamed again).
-- =========================================================================

ALTER TABLE public.activity_feed
  DROP CONSTRAINT IF EXISTS activity_feed_activity_type_check;

ALTER TABLE public.activity_feed
  ADD CONSTRAINT activity_feed_activity_type_check
  CHECK (activity_type = ANY (ARRAY[
    'steps'::text,
    'workout'::text,
    'calories'::text,
    'water'::text,
    'daily_winner'::text,
    'took_lead'::text,
    'all_goals'::text,
    'goals_updated'::text,
    'pack_renamed'::text
  ]));

DROP INDEX IF EXISTS public.idx_activity_feed_no_dup_goals;

CREATE UNIQUE INDEX idx_activity_feed_no_dup_goals
  ON public.activity_feed (user_id, pack_id, activity_type, score_date)
  WHERE activity_type IN (
    'steps', 'calories', 'water',
    'took_lead', 'all_goals',
    'goals_updated', 'pack_renamed'
  );

COMMIT;
