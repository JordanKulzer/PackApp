// Single dispatcher for unified timeline rows. Three variants:
//
//   - System-style activity events (took_lead, all_goals) → centered
//     SystemMessageRow, no avatar/reactions/long-press.
//   - Other activity events → FeedItemRow (delegated via renderActivity
//     callback so the caller can swap in the live useActivityFeed item
//     for optimistic reaction state).
//   - Chat messages → ChatMessageRow with grouping + self-tint +
//     reactions/picker/action-menu hooks.

import React from "react";
import type { TimelineItem } from "../types/timeline";
import type { FeedItem } from "../hooks/useActivityFeed";
import type { ChatMessage } from "../types/database";
import { ChatMessageRow } from "./ChatMessageRow";
import { SystemMessageRow } from "./SystemMessageRow";
import type { AnchorPosition } from "./MessageActionMenu";

const SYSTEM_ACTIVITY_TYPES = new Set<FeedItem["activityType"]>([
  "took_lead",
  "all_goals",
  "goals_updated",
  "pack_renamed",
]);

interface Props {
  item: TimelineItem;
  currentUserId: string | undefined;
  // Caller-provided renderer for activity rows that aren't system-style.
  // Keeps useActivityFeed lookup logic in the caller.
  renderActivity: (data: FeedItem) => React.ReactNode;
  // Chat-message hooks. Computed/owned by the parent ChatTab.
  isGrouped?: boolean;
  onActionMenuOpen: (message: ChatMessage, anchor: AnchorPosition) => void;
  onOpenPicker: (messageId: string, anchor: AnchorPosition) => void;
  onToggleChatReaction: (messageId: string, emoji: string) => void;
  // Optional pack context, forwarded to ChatMessageRow so its avatar-tap
  // can include ?packId= for the public profile's pack-scoped Trends.
  // Activity rows reach FeedItemRow via the renderActivity callback —
  // their pack context is captured in the caller's closure, so this
  // prop doesn't need to forward into that branch.
  packId?: string;
}

export function TimelineRow({
  item,
  currentUserId,
  renderActivity,
  isGrouped,
  onActionMenuOpen,
  onOpenPicker,
  onToggleChatReaction,
  packId,
}: Props) {
  if (item.kind === "activity") {
    // Pass 25-followup-E.2.b.iii-fix-2: photo-bearing took_lead rows route
    // to the full feed renderer (FeedItemRow) so the user-attached photo
    // + caption display. Photo-less took_lead rows keep the minimal
    // centered system-message treatment. all_goals / goals_updated /
    // pack_renamed always stay system-style.
    const isSystem = SYSTEM_ACTIVITY_TYPES.has(item.data.activityType);
    const isPhotoTookLead =
      item.data.activityType === "took_lead" && !!item.data.photoUrl;
    if (isSystem && !isPhotoTookLead) {
      return (
        <SystemMessageRow
          item={item.data}
          isMe={item.data.userId === currentUserId}
        />
      );
    }
    return <>{renderActivity(item.data)}</>;
  }
  return (
    <ChatMessageRow
      message={item.data}
      currentUserId={currentUserId}
      isGrouped={isGrouped}
      onActionMenuOpen={onActionMenuOpen}
      onOpenPicker={onOpenPicker}
      onToggleReaction={onToggleChatReaction}
      packId={packId}
    />
  );
}
