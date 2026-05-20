// Per-pack crossing-event types emitted by the sync writers.
//
// Categories pivot, Stage 2B: the took_lead detection functions
// (detectAndRecordTookLead, isCurrentlyLeading) were removed — took_lead
// is points-coupled and is being dropped as a concept. Only the
// CrossingEvent / CrossingActivityType type shapes remain, still consumed
// by syncWater / logActivity / healthkit as their return type.
//
// Vestigial, deferred to Phase B: the `pointsEarned` field on CrossingEvent
// and the `took_lead` member of CrossingActivityType — both inert (sync
// writers now emit pointsEarned: 0 and nothing produces took_lead rows).

export type CrossingActivityType =
  | "steps"
  | "workout"
  | "calories"
  | "water"
  | "all_goals"
  | "took_lead";

// Per-pack record emitted by sync functions for each activity_feed row
// they successfully insert.
export type CrossingEvent = {
  packId: string;
  packName: string;
  packTimezone: string;
  feedItemId: string;
  activityType: CrossingActivityType;
  pointsEarned: number;
  scoreDate: string;
};
