-- Pass 25-followup-E.2.a.i — Add manual-share activity_types
--
-- Expands activity_feed.activity_type CHECK to include suffix-style
-- share values. Manual shares are deliberate user actions; they should
-- NOT dedup. The existing partial unique index idx_activity_feed_no_dup_goals
-- only constrains the existing 5 types in its WHERE clause — new share
-- types are deliberately omitted, so they remain unconstrained.
--
-- This migration is no-op-additive: schema accepts new values but no
-- code emits them yet. Share emission code lands in Pass 25-followup-E.2.b.
--
-- Rollback: revert CHECK to the prior 7-value list. Safe only if no
-- share rows exist (post-E.2.b emission, rollback requires deleting
-- share rows first or the CHECK will fail on the existing rows).

ALTER TABLE public.activity_feed
  DROP CONSTRAINT IF EXISTS activity_feed_activity_type_check;

ALTER TABLE public.activity_feed
  ADD CONSTRAINT activity_feed_activity_type_check
  CHECK (activity_type = ANY (ARRAY[
    'steps'::text, 'workout'::text, 'calories'::text,
    'water'::text, 'daily_winner'::text,
    'took_lead'::text, 'all_goals'::text,
    'steps_share'::text, 'calories_share'::text,
    'water_share'::text, 'workout_share'::text
  ]));
