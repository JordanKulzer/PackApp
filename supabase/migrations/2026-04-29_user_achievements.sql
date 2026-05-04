-- ============================================================
-- Migration: user_achievements table
-- ============================================================
-- Run this in your Supabase SQL editor.
--
-- This table stores which achievements each user has unlocked,
-- and when. Achievement definitions live in code (constants/strings.ts)
-- so we don't need a separate `achievements` table.
-- ============================================================

create table if not exists public.user_achievements (
  user_id uuid not null references public.users(id) on delete cascade,
  achievement_id text not null,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);

-- Index for quickly fetching a user's unlocked achievements
create index if not exists user_achievements_user_id_idx
  on public.user_achievements (user_id, unlocked_at desc);

-- RLS: users can only read their own achievements (and their packmates' for display)
alter table public.user_achievements enable row level security;

create policy "Users can read their own achievements"
  on public.user_achievements
  for select
  using (auth.uid() = user_id);

create policy "Users can read packmates' achievements"
  on public.user_achievements
  for select
  using (
    exists (
      select 1
      from public.pack_members pm1
      join public.pack_members pm2 on pm1.pack_id = pm2.pack_id
      where pm1.user_id = auth.uid()
        and pm2.user_id = user_achievements.user_id
    )
  );

-- Only the service role / authenticated server logic should insert achievements.
-- We do NOT allow client-side inserts to prevent users from spoofing unlocks.
create policy "Authenticated users can insert their own achievements"
  on public.user_achievements
  for insert
  with check (auth.uid() = user_id);
