-- Phase C.4: unified reactions across activity + chat
--
-- Idempotent — safe to re-run. Each statement uses IF EXISTS / IF NOT
-- EXISTS or guards against duplicate errors so partial-failure recovery
-- doesn't require manual cleanup.

-- ── 1. Loosen activity_reactions ────────────────────────────────────────────

ALTER TABLE public.activity_reactions
  DROP CONSTRAINT IF EXISTS activity_reactions_reaction_type_check;

-- ── 2. Create chat_message_reactions ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.chat_message_reactions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   uuid        NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES public.users(id)         ON DELETE CASCADE,
  reaction_type text       NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_message_reactions_message_id
  ON public.chat_message_reactions (message_id);

-- ── 3. Row Level Security ───────────────────────────────────────────────────

ALTER TABLE public.chat_message_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Pack members can view chat reactions"
  ON public.chat_message_reactions;
CREATE POLICY "Pack members can view chat reactions"
  ON public.chat_message_reactions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.chat_messages
      JOIN public.pack_members
        ON pack_members.pack_id = chat_messages.pack_id
      WHERE chat_messages.id = chat_message_reactions.message_id
        AND pack_members.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert their own chat reactions"
  ON public.chat_message_reactions;
CREATE POLICY "Users can insert their own chat reactions"
  ON public.chat_message_reactions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own chat reactions"
  ON public.chat_message_reactions;
CREATE POLICY "Users can delete their own chat reactions"
  ON public.chat_message_reactions
  FOR DELETE
  USING (auth.uid() = user_id);

-- ── 4. Realtime ─────────────────────────────────────────────────────────────
-- ALTER PUBLICATION has no IF NOT EXISTS; wrap in a guard that tolerates
-- the table already being on the publication.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_message_reactions;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
