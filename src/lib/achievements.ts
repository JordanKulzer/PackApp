/**
 * Pack — Achievement service
 * --------------------------------------------------------------------------
 * Runtime checking and unlocking of achievements. Hook this into the events
 * that change scores/streaks/packs, and it will detect unlocks, fire push
 * notifications, and persist the unlock to Supabase.
 *
 * Path: lib/achievements.ts
 *
 * Requires a Supabase table `user_achievements`:
 *   create table user_achievements (
 *     user_id uuid references users(id) on delete cascade,
 *     achievement_id text not null,
 *     unlocked_at timestamptz not null default now(),
 *     primary key (user_id, achievement_id)
 *   );
 * --------------------------------------------------------------------------
 */

import { achievements, push, type Achievement } from '../constants/strings';
import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';

export interface AchievementContext {
  userId: string;
  // Stats — only populate the ones that changed in the current event
  currentStreakDays?: number;
  packSize?: number;
  isAlphaThisWeek?: boolean;
  consecutiveAlphaWeeks?: number;
  totalReactionsGiven?: number;
  daysAwayBeforeReturn?: number;
  activityLoggedAtHour?: number; // 0-23
  activeInPackCount?: number;
  receivedFirstReaction?: boolean;
  fullPackHitTargets?: boolean;
  isFirstActivityEver?: boolean;
}

/** Returns achievement IDs that should fire for this context. */
export function checkUnlocks(ctx: AchievementContext): string[] {
  const unlocks: string[] = [];

  if (ctx.isFirstActivityEver) unlocks.push('firstHowl');
  if (ctx.packSize === 1 && ctx.currentStreakDays && ctx.currentStreakDays >= 1) {
    unlocks.push('loneWolf');
  }
  if (ctx.consecutiveAlphaWeeks && ctx.consecutiveAlphaWeeks >= 4) unlocks.push('alpha');
  if (ctx.packSize && ctx.packSize >= 5) unlocks.push('denMother');
  if (ctx.currentStreakDays === 30) unlocks.push('trailBlazer');
  if (ctx.currentStreakDays === 100) unlocks.push('longHunter');
  if (ctx.fullPackHitTargets) unlocks.push('packHunter');
  if (ctx.activityLoggedAtHour !== undefined && ctx.activityLoggedAtHour < 6) {
    unlocks.push('howlInTheDark');
  }
  if (ctx.totalReactionsGiven && ctx.totalReactionsGiven >= 50) unlocks.push('scentTracker');
  if (ctx.daysAwayBeforeReturn && ctx.daysAwayBeforeReturn >= 14) {
    unlocks.push('returnOfTheWolf');
  }
  if (ctx.activeInPackCount && ctx.activeInPackCount >= 2) unlocks.push('twoPack');
  if (ctx.receivedFirstReaction) unlocks.push('firstHowlHeard');

  return unlocks;
}

/**
 * Process a context, persist any new unlocks to Supabase, and fire local
 * notifications. Returns the list of newly-unlocked achievement IDs.
 */
export async function processAchievements(ctx: AchievementContext): Promise<string[]> {
  const candidates = checkUnlocks(ctx);
  if (candidates.length === 0) return [];

  // Filter out ones the user already has
  const { data: existing, error } = await supabase
    .from('user_achievements')
    .select('achievement_id')
    .eq('user_id', ctx.userId)
    .in('achievement_id', candidates);

  if (error) {
    console.warn('[achievements] failed to read existing unlocks', error);
    return [];
  }

  const alreadyUnlocked = new Set(
    (existing ?? []).map((r: { achievement_id: string }) => r.achievement_id),
  );
  const newUnlocks = candidates.filter((id) => !alreadyUnlocked.has(id));
  if (newUnlocks.length === 0) return [];

  // Persist the new unlocks
  const rows = newUnlocks.map((id) => ({
    user_id: ctx.userId,
    achievement_id: id,
  }));
  const { error: insertError } = await supabase
    .from('user_achievements')
    .insert(rows);

  if (insertError) {
    console.warn('[achievements] failed to insert unlocks', insertError);
    return [];
  }

  // Fire a local notification for each new unlock (staggered slightly)
  for (let i = 0; i < newUnlocks.length; i++) {
    const id = newUnlocks[i];
    const ach = achievements[id];
    if (!ach) continue;
    const payload = push.achievementUnlocked(ach.name, ach.copy);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: payload.title,
        body: payload.body,
        data: { achievementId: id },
      },
      trigger: i === 0 ? null : { seconds: i * 2 } as any,
    });
  }

  return newUnlocks;
}

/** Fetch all unlocked achievements for a user. */
export async function getUserAchievements(userId: string) {
  const { data, error } = await supabase
    .from('user_achievements')
    .select('achievement_id, unlocked_at')
    .eq('user_id', userId)
    .order('unlocked_at', { ascending: false });

  if (error) {
    console.warn('[achievements] failed to fetch user achievements', error);
    return [];
  }

  type UserAchievementRow = { achievement_id: string; unlocked_at: string };
  return (data ?? [])
    .map((row: UserAchievementRow) => ({
      ...achievements[row.achievement_id],
      unlockedAt: row.unlocked_at,
    }))
    .filter(
      (a): a is Achievement & { unlockedAt: string } =>
        typeof (a as Partial<Achievement>).id === 'string',
    );
}
