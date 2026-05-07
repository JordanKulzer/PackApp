// Centered system-message row for activity events that aren't really
// "things a user did" — e.g. took the lead, completed all goals.
// No avatar, no name+content layout, no reactions. Just a single faint
// centered line.
//
// Streak milestones and "joined the pack" are out of scope for this
// round (no event emit path exists yet); when those are added, route
// them through this same component.

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { FeedItem } from "../hooks/useActivityFeed";
import { formatName } from "../lib/displayName";

interface Props {
  item: FeedItem;
  isMe: boolean;
}

function buildSystemText(item: FeedItem, isMe: boolean): string {
  const name = isMe ? "You" : formatName(item.displayName);
  switch (item.activityType) {
    case "took_lead":
      return `${name} took the lead 👑`;
    case "all_goals":
      return item.value > 0
        ? `${name} completed all ${item.value} goals today 🎉`
        : `${name} completed all goals today 🎉`;
    // TODO(voice review): refined copy for Pass 20e. The {date} comes from
    // item.caption set at insert time (e.g., "Monday, May 11"). Old rows
    // (Pass 20d-shipped) have caption=null and use the fallback variant.
    case "goals_updated":
      return item.caption
        ? `Goals updated · Applied ${item.caption}`
        : `${name} updated the pack's goals`;
    // TODO(voice review): placeholder copy for Pass 20e. {newName} comes
    // from item.caption set at insert time — historical accuracy preserved
    // (no live join means future renames don't mutate old messages).
    case "pack_renamed":
      return item.caption
        ? `Pack renamed to ${item.caption}`
        : `${name} renamed the pack`;
    default:
      // Fallback (shouldn't reach for system-message types we route here).
      return `${name} · ${item.activityType}`;
  }
}

export function SystemMessageRow({ item, isMe }: Props) {
  return (
    <View style={s.row}>
      <Text style={s.text} numberOfLines={2}>
        {buildSystemText(item, isMe)}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    alignItems: "center",
  },
  text: {
    fontSize: 13,
    color: "#8A8A8E",
    textAlign: "center",
  },
});
