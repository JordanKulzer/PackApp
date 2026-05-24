import PostHog from "posthog-react-native";
// PostHogEventProperties type isn't re-exported from posthog-react-native
// (verified during Pass 12 — only @posthog/core exports it, reaching past
// the package boundary feels wrong). All typed event helpers in the
// `analytics` object below pass JSON-shape props (string/number/boolean/null),
// so the cast at the capture call is safe. Tighten if PostHog ever re-exports.
import type { PostHogEventProperties } from "@posthog/core";

let _client: PostHog | null = null;

export function initAnalytics(): void {
  const key = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  _client = new PostHog(key, {
    host: "https://us.i.posthog.com",
    disabled: __DEV__,
    // Flush every event immediately. PostHog's default (flushAt: 20,
    // flushInterval: 30000) batches events client-side; a single milestone
    // event like signup_completed can sit in the queue for up to 30s before
    // shipping, which made Pass 9 verification think the event wasn't firing.
    // Pack's event volume is low enough that one HTTP request per event is
    // a negligible cost (~12 typed events, low-frequency). If volume grows,
    // revisit. Verified working with Pass 9 funnel events.
    flushAt: 1,
  });
}

export function capture(
  event: string,
  properties?: Record<string, unknown>,
): void {
  _client?.capture(event, properties as PostHogEventProperties | undefined);
}

// ─────────────────────────────────────────────────────────────────────────────
// Identity
//
// identify() should fire on SIGNED_IN only — repeated identify() calls with
// the same UUID are no-ops at the SDK level, but firing on every TOKEN_REFRESHED
// burns marginal SDK work for no benefit. The auth-state-change listener in
// app/_layout.tsx gates on event === "SIGNED_IN".
//
// reset() runs on sign-out so the next anonymous session doesn't get linked
// to the prior user. PostHog's distinct ID rolls over.
// ─────────────────────────────────────────────────────────────────────────────

export function identify(userId: string): void {
  _client?.identify(userId);
}

export function reset(): void {
  _client?.reset();
}

// Best-effort flush — used before destructive actions (account deletion in a
// future pass) so the final event lands before the user's data is wiped.
export async function flushAnalytics(): Promise<void> {
  try {
    await _client?.flush();
  } catch {
    // non-fatal — flush is best-effort, not a correctness gate
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Typed event helpers
//
// All event names use snake_case (PostHog convention); function names are
// camelCase. Each function is the single source of truth for its property
// shape — if you're adding a new property, add it here, not at the call site.
// ─────────────────────────────────────────────────────────────────────────────

export const analytics = {
  // ── Pre-existing helpers — kept as-is ────────────────────────────────────
  paywallDismissed: (
    trigger: string,
    dismiss_method: "cancel" | "x" | "swipe" | "hardware_back" = "cancel",
  ) => capture("paywall_dismissed", { trigger, dismiss_method }),
  proRestored: () => capture("pro_restored"),
  gateHit: (feature: string) => capture("gate_hit", { feature }),
  photoAdded: (activityType: string, packId: string) =>
    capture("photo_added", { activity_type: activityType, pack_id: packId }),
  photoUploadFailed: (error: string) =>
    capture("photo_upload_failed", { error }),
  photoViewedFullscreen: (feedItemId: string) =>
    capture("photo_viewed_fullscreen", { feed_item_id: feedItemId }),
  photoReported: (reason: string) => capture("photo_reported", { reason }),

  // ── Pass 9 funnel events ─────────────────────────────────────────────────

  signupCompleted: (props: {
    onboarding_duration_sec: number;
    signup_method: "email" | "apple" | "google" | "unknown";
    categories_selected_count: number;
    enabled_healthkit: boolean;
    completed_via: "finish" | "skip";
  }) => capture("signup_completed", props),

  packCreated: (props: {
    is_first_pack: boolean;
    goal_count: number;
    member_limit_chosen: number;
    cadence: "weekly" | "monthly";
    current_pack_count: number;
  }) => capture("pack_created", props),

  packJoined: (props: {
    is_first_join: boolean;
    pack_member_count_at_join: number;
    current_pack_count: number;
    join_source: "modal" | "deep_link";
  }) => capture("pack_joined", props),

  packLeft: (props: {
    pack_member_count_at_leave: number;
    days_in_pack: number;
    points_earned_in_pack: number;
  }) => capture("pack_left", props),

  // 12th event — owner-deletion is a different signal from pack_left because
  // it ends the pack for everyone. Decision recorded in Pass 9 audit.
  packDeleted: (props: {
    pack_member_count_at_deletion: number;
    days_pack_existed: number;
    pack_was_owner: true; // always true under current rules — only owners can delete
    total_activities_in_pack: number | null; // null if SUM query is too expensive at deletion time
  }) => capture("pack_deleted", props),

  // ── Activity logging ─────────────────────────────────────────────────────
  // Goal-removal Part 3a: goal_hit_today dropped — the *_achieved
  // booleans that derived it are gone. The "B-style transition gating"
  // (fire only on goal-cross) was paired to the same booleans; under
  // the categories pivot callers fire this per user-action (manual log
  // / water sync) rather than on a transition. healthkit's per-type
  // transitions emit was dropped entirely (background syncs would have
  // produced too much noise without a transition gate).
  activityLogged: (props: {
    activity_type: "steps" | "workout" | "calories" | "water";
    source: "healthkit" | "manual";
    points_earned: number;
    is_first_ever: boolean;
    streak_days_after: number;
  }) => capture("activity_logged", props),

  // Fires when streak crosses a milestone threshold (3, 7, 14, 30, 60, 90).
  // Computed from priorRow.streak_days < threshold && newStreakDays >= threshold.
  // Only the highest crossed milestone fires per update (avoids burst of 3+
  // events when backfill jumps streak from 0 to 30+).
  streakMilestone: (props: {
    milestone_days: 3 | 7 | 14 | 30 | 60 | 90;
    pack_id: string;
    prior_milestone_days: number;
  }) => capture("streak_milestone", props),

  reactionGiven: (props: {
    is_first_reaction_ever: boolean;
    reaction_type: string;
    target_activity_type: string;
    target_user_is_self: boolean;
  }) => capture("reaction_given", props),

  paywallViewed: (props: {
    trigger: string;
    current_pack_count: number;
    current_member_count_in_largest_pack: number;
  }) => capture("paywall_viewed", props),

  // Replaces the prior `proSubscribed` helper. trigger_at_view should match
  // the trigger passed to the most recent paywall_viewed.
  paywallConverted: (props: {
    product_id: string;
    trigger_at_view: string;
    time_to_convert_sec: number;
  }) => capture("paywall_converted", props),

  // Pass 10a — fired BEFORE destruction by src/lib/accountDeletion.ts so
  // property-computing queries see live state. flushAnalytics() is awaited
  // immediately after this call to guarantee PostHog ships the event before
  // the user's data is wiped.
  accountDeleted: (props: {
    days_since_signup: number;
    pack_count_at_deletion: number;
    had_pro_subscription: boolean;
    last_active_at_days_ago: number;
    deletion_reason: string | null;
  }) => capture("account_deleted", props),

  // Pass 9-deferred — not wired yet. See breadcrumb at src/lib/revenuecat.ts
  // (subscription state monitoring). When the firing site lands, expose
  // a typed helper here.
};
