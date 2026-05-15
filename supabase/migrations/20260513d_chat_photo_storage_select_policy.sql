-- Pass C-revised follow-up — Storage RLS for chat photo reads.
--
-- THE BUG: chat photos upload fine to activity_photos/${userId}/chat_${id}.jpg
-- (uploadChatPhoto succeeds, chat_messages.photo_url is set), but
-- getSignedUrl → storage.createSignedUrl returns "StorageApiError:
-- Object not found".
--
-- ROOT CAUSE: it is NOT a bucket mismatch — uploadChatPhoto,
-- uploadVictoryPhoto, and getSignedUrl all target "activity_photos".
-- The activity_photos bucket's SELECT policy on storage.objects
-- (dashboard-configured, not in this repo) authorizes reads by joining
-- storage.objects.name against activity_feed.photo_url + pack
-- membership. A chat photo's path lives in chat_messages.photo_url,
-- NOT activity_feed — so that join never matches, the read is denied,
-- and Supabase flattens an RLS-denied storage read into "Object not
-- found". This is why even the sender can't see their own chat photo
-- (the join fails for everyone), while victory photos — whose
-- photo_url IS in activity_feed — render fine.
--
-- THE FIX: add a PARALLEL SELECT policy keyed off chat_messages.
-- Postgres combines permissive policies for the same command with OR,
-- so this can only GRANT additional read access — it cannot affect the
-- existing activity_feed-based victory/took_lead photo reads.
--
-- Membership predicate mirrors the chat_message_reactions SELECT
-- policy from 20260427_chat_reactions_unification.sql (EXISTS join
-- through chat_messages → pack_members, keyed on auth.uid()).
--
-- Idempotent — DROP POLICY IF EXISTS guard so re-running is safe.
--
-- ROLLBACK:
--   DROP POLICY IF EXISTS "Pack members can view chat photos" ON storage.objects;

DROP POLICY IF EXISTS "Pack members can view chat photos"
  ON storage.objects;
CREATE POLICY "Pack members can view chat photos"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'activity_photos'
    AND EXISTS (
      SELECT 1
      FROM public.chat_messages
      JOIN public.pack_members
        ON pack_members.pack_id = chat_messages.pack_id
      WHERE chat_messages.photo_url = storage.objects.name
        AND pack_members.user_id = auth.uid()
    )
  );
