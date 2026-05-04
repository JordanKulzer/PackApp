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
}

export function TimelineRow({
  item,
  currentUserId,
  renderActivity,
  isGrouped,
  onActionMenuOpen,
  onOpenPicker,
  onToggleChatReaction,
}: Props) {
  if (item.kind === "activity") {
    if (SYSTEM_ACTIVITY_TYPES.has(item.data.activityType)) {
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
    />
  );
}
