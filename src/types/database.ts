// TypeScript types matching the Supabase schema
// Generate these automatically with: npx supabase gen types typescript

export type SubscriptionTier = "free" | "pro";
export type CompetitionWindow = "weekly" | "monthly";
// Pass 25-followup-E.2.b.i: expanded to mirror the activity_feed.activity_type
// CHECK constraint state post-E.2.a.i migration. Grouped by semantic category
// for readability. `goals_updated` and `pack_renamed` are retained for the
// defensive consumer branches in useActivityFeed / SystemMessageRow /
// TimelineRow even though the E.2.a.i migration accidentally dropped them
// from the CHECK constraint — a corrective migration (or consumer cleanup)
// is tracked separately.
export type ActivityType =
  // Per-activity goal-cross
  | "steps" | "workout" | "calories" | "water"
  // System / derived events
  | "took_lead" | "all_goals" | "daily_winner"
  // Manual share (user-initiated, no dedup) — emit path lands in E.3
  | "steps_share" | "calories_share" | "water_share" | "workout_share"
  // Pack-level events (dead post-E.2.a.i regression — keep until corrective migration)
  | "goals_updated" | "pack_renamed";
export type RunStatus = "active" | "completed";
export type MemberRole = "admin" | "member";
export type NotificationType =
  | "friend_checked_in"
  | "leaderboard_change"
  | "streak_at_risk"
  | "weekly_winner"
  | "pack_invite";

export interface User {
  id: string;
  display_name: string;
  avatar_url: string | null;
  apns_token: string | null;
  healthkit_authorized: boolean;
  subscription_tier: SubscriptionTier;
  subscription_expires_at: string | null;
  // Pinned activity categories driving the LogSheet "Quick Select" grid.
  // Up to 6, order preserved (first = leftmost). Empty array means
  // unpinned / new user before onboarding category step.
  quick_select_categories: string[];
  created_at: string;
  updated_at: string;
}

export interface Pack {
  id: string;
  name: string;
  created_by: string;
  invite_code: string;
  is_active: boolean;
  steps_enabled: boolean;
  workouts_enabled: boolean;
  calories_enabled: boolean;
  water_enabled: boolean;
  step_target: number;
  calorie_target: number;
  water_target_oz: number;
  competition_window: CompetitionWindow;
  timezone: string;
  created_at: string;
  // Pending goal-target changes (Pass 20). NULL = no pending change for
  // that field. Applied to the live target at the next run rollover and
  // cleared. pending_changes_at is a single timestamp covering the entire
  // pending state (D3 — overwrite on re-edit). Goal-removal Part 1
  // stopped writing the *_target columns but kept them on the table; the
  // rollover RPC still clears them defensively.
  pending_step_target: number | null;
  pending_calorie_target: number | null;
  pending_water_target_oz: number | null;
  // Pending category-enable changes (Phase 2 — migration 20260525).
  // NULL = no pending change for that category. Applied to the live
  // *_enabled column at the next run rollover and cleared. Same
  // pending_changes_at timestamp covers these alongside the goal-target
  // pendings as a single unit.
  pending_steps_enabled: boolean | null;
  pending_workouts_enabled: boolean | null;
  pending_calories_enabled: boolean | null;
  pending_water_enabled: boolean | null;
  pending_changes_at: string | null;
}

export interface PackMember {
  id: string;
  pack_id: string;
  user_id: string;
  role: MemberRole;
  joined_at: string;
  is_active: boolean;
}

export interface Run {
  id: string;
  pack_id: string;
  start_date: string;
  end_date: string;
  status: RunStatus;
  winner_id: string | null;
  created_at: string;
}

export interface DailyScore {
  id: string;
  run_id: string;
  user_id: string;
  score_date: string;
  total_points: number;
  streak_days: number;
  streak_multiplier: number;
  // *_achieved booleans dropped 2026-06-01: Goal-removal Part 3a/3b
  // already stopped writing them and no UI consumer remains
  // (grep .steps_achieved / .workout_achieved / .calories_achieved /
  // .water_achieved across src+app returns only stale comments).
  // Type-level removal here; DB column drop deferred to a later
  // sweep migration alongside total_points + streak_multiplier.
  steps_count: number;
  calories_count: number;
  workout_count: number;
  water_oz_count: number;
  hk_steps_count: number;
  hk_calories_count: number;
  hk_workout_count: number;
  // F.2: source-isolated manual counters. steps_count / calories_count
  // above are DB-generated as (manual_*_count + hk_*_count) STORED — see
  // migration 20260513b. M badge derives from manual_*_count > 0
  // (replaced the prior has_manual_* booleans).
  manual_steps_count: number;
  manual_calories_count: number;
  updated_at: string;
}

export interface ActivityLog {
  id: string;
  user_id: string;
  activity_type: ActivityType;
  points_earned: number;
  activity_date: string;
  healthkit_data: Record<string, unknown> | null;
  synced_at: string;
}

export interface WaterLog {
  id: string;
  user_id: string;
  amount_oz: number;
  log_date: string;
  logged_at: string;
}

export interface DailyWinner {
  id: string;
  pack_id: string;
  run_id: string;
  score_date: string;
  winner_user_ids: string[];
  winning_points: number;
  computed_at: string;
}

export interface FeedComment {
  id: string;
  feed_item_id: string;
  parent_id: string | null;
  user_id: string;
  body: string;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  pack_id: string;
  user_id: string;
  body: string;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  is_deleted: boolean;
  // Pass C-revised: optional storage path for chat-attached photos.
  // Path convention `${userId}/chat_${chatMessageId}.jpg` in the
  // activity_photos bucket. Use getSignedUrl to render.
  photo_url?: string | null;
}

