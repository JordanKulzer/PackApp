-- Store the photo's native aspect ratio on activity_feed at INSERT time so
-- FeedItemRow can render the photo wrap at the correct ratio synchronously
-- (no Image.getSize round-trip). The source dimensions are already returned
-- by expo-image-picker at pick time and were previously discarded — this
-- column is the missing plumbing.
--
-- Nullable, no default. Additive: pre-existing rows stay NULL and
-- FeedItemRow falls back to the existing Image.getSize path for them.
-- New shares (created after this migration applies) carry the aspect on
-- the row → flicker-free first paint.

BEGIN;

ALTER TABLE public.activity_feed
  ADD COLUMN IF NOT EXISTS photo_aspect numeric;

COMMIT;
