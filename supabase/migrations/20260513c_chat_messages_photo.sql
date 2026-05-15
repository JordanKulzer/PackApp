-- Pass C-revised (2026-05-13) — chat photo attachment support.
--
-- Adds photo_url to chat_messages. Mirrors the activity_feed.photo_url
-- pattern (storage path string, NULL when no photo). Storage convention
-- is `${userId}/chat_${chatMessageId}.jpg` in the activity_photos
-- bucket (see src/lib/photoUpload.ts:uploadChatPhoto).
--
-- Idempotent — IF NOT EXISTS so re-applying is a no-op. Existing rows
-- default to NULL (no backfill — pre-pass chat had no photos).
--
-- ROLLBACK:
--   ALTER TABLE public.chat_messages DROP COLUMN IF EXISTS photo_url;

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS photo_url TEXT;
