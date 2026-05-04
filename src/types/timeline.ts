// Discriminated union for the unified Chat timeline. Activity events from
// activity_feed and human messages from chat_messages share a sortKey so the
// merged stream can be ordered chronologically without consulting the
// underlying tables.

import type { ChatMessage } from "./database";
import type { FeedItem, Reactor } from "../hooks/useActivityFeed";

export type TimelineItem =
  | { kind: "activity"; data: FeedItem; sortKey: string }
  | {
      kind: "message";
      data: ChatMessage & {
        author: {
          id: string;
          display_name: string;
          avatar_url: string | null;
        };
        // Reactions on chat messages. Same flat-reactor shape as
        // FeedItem.reactions; ReactionPills aggregates at render time.
        reactions: Reactor[];
      };
      sortKey: string;
    };
