// Unified reaction display — compact horizontal pills, one per unique
// emoji, with count. Tap a pill to toggle that emoji as the current
// user's reaction (one-per-user: if you already have that emoji, it's
// removed; if you have a different one, it's replaced; if you have none,
// it's added).
//
// Used by both ChatMessageRow and FeedItemRow. Aggregates the flat
// reactor list at render time so the data shape can stay simple
// upstream.

import React, { useMemo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import type { Reactor } from "../hooks/useActivityFeed";

interface Props {
  reactions: Reactor[];
  currentUserId: string | undefined;
  onToggle: (emoji: string) => void;
}

interface AggregatedReaction {
  emoji: string;
  count: number;
  hasReacted: boolean;
}

export function ReactionPills({ reactions, currentUserId, onToggle }: Props) {
  const aggregated = useMemo<AggregatedReaction[]>(() => {
    const byEmoji = new Map<string, AggregatedReaction>();
    for (const r of reactions) {
      const existing = byEmoji.get(r.reaction_type);
      if (existing) {
        existing.count += 1;
        if (r.user_id === currentUserId) existing.hasReacted = true;
      } else {
        byEmoji.set(r.reaction_type, {
          emoji: r.reaction_type,
          count: 1,
          hasReacted: r.user_id === currentUserId,
        });
      }
    }
    return [...byEmoji.values()];
  }, [reactions, currentUserId]);

  if (aggregated.length === 0) return null;

  return (
    <View style={s.row}>
      {aggregated.map((rx) => (
        <Pressable
          key={rx.emoji}
          style={({ pressed }) => [
            s.pill,
            rx.hasReacted && s.pillActive,
            pressed && { opacity: 0.7 },
          ]}
          onPress={() => onToggle(rx.emoji)}
          hitSlop={4}
        >
          <Text style={s.pillEmoji}>{rx.emoji}</Text>
          <Text style={[s.pillCount, rx.hasReacted && s.pillCountActive]}>
            {rx.count}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 6,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    height: 24,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: "#1C1C1E",
    borderWidth: 1,
    borderColor: "#2C2C2E",
    gap: 4,
  },
  pillActive: {
    backgroundColor: "rgba(10, 132, 255, 0.15)",
    borderColor: "#0A84FF",
  },
  pillEmoji: {
    fontSize: 13,
  },
  pillCount: {
    fontSize: 12,
    color: "#8A8A8E",
    fontWeight: "600",
  },
  pillCountActive: {
    color: "#0A84FF",
  },
});
