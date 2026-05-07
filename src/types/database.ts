// TypeScript types matching the Supabase schema
// Generate these automatically with: npx supabase gen types typescript

export type SubscriptionTier = "free" | "pro";
export type CompetitionWindow = "weekly" | "monthly";
export type ActivityType = "steps" | "workout" | "calories" | "water" | "daily_winner" | "goals_updated" | "pack_renamed";
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
  // pending state (D3 — overwrite on re-edit).
  pending_step_target: number | null;
  pending_calorie_target: number | null;
  pending_water_target_oz: number | null;
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
  steps_achieved: boolean;
  workout_achieved: boolean;
  calories_achieved: boolean;
  water_achieved: boolean;
  steps_count: number;
  calories_count: number;
  workout_count: number;
  water_oz_count: number;
  hk_steps_count: number;
  hk_calories_count: number;
  hk_workout_count: number;
  has_manual_steps: boolean;
  has_manual_calories: boolean;
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
}

// Leaderboard row — joined query result
export interface LeaderboardEntry {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  total_points: number;
  streak_days: number;
  streak_multiplier: number;
  steps_achieved: boolean;
  workout_achieved: boolean;
  calories_achieved: boolean;
  water_achieved: boolean;
  rank: number;
}
