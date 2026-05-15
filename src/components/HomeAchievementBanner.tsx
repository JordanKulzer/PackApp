// Pass 25-followup-E.2.b.iii: Home-level achievement banner.
//
// Rendered above the pack cards list (via FlatList ListHeaderComponent)
// when useUnpostedAchievements has a queue head matching the active kinds.
// Tap → opens VictoryPostSheet; X → onDismiss (local-only via AsyncStorage,
// per the threatNotifications canSendThreat/markThreatSent pattern).
//
// Co-located AsyncStorage helpers: kept here rather than a separate
// module since they're banner-scoped. If a second consumer ever needs
// dismissal state, extract.

import AsyncStorage from "@react-native-async-storage/async-storage";
import React from "react";
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../theme/colors";
import type { UnpostedAchievement, UnpostedAchievementKind } from "../hooks/useUnpostedAchievements";

const C = {
  surface: "#121821",
  surfaceRaised: "#1C2333",
  border: "#30363D",
  textPrimary: "#E6EDF3",
  textSecondary: "#8B949E",
  success: "#3FB950",
} as const;

// ── AsyncStorage dismissal ───────────────────────────────────────────────
// Keys: achievement:dismissed:{feedItemId}. Value: timestamp string.
// Fails open on AsyncStorage errors (per threatNotifications pattern) —
// worst case the banner reappears for an already-dismissed achievement,
// which is annoying but not broken. TODO(polish): periodic cleanup of
// keys older than 30 days; AsyncStorage usage stays small without it but
// accumulates over time.
const DISMISSED_KEY_PREFIX = "achievement:dismissed:";

export async function isAchievementDismissed(feedItemId: string): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(DISMISSED_KEY_PREFIX + feedItemId);
    return !!raw;
  } catch {
    return false; // fail open
  }
}

export async function markAchievementDismissed(feedItemId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(DISMISSED_KEY_PREFIX + feedItemId, String(Date.now()));
  } catch {
    // non-critical
  }
}

// ── Copy lookup ──────────────────────────────────────────────────────────
const BANNER_COPY: Record<UnpostedAchievementKind, { title: string; subtitle: string }> = {
  took_lead:    { title: "You took the lead in {packName}", subtitle: "Tap to share" },
  all_goals:    { title: "All goals hit in {packName}",     subtitle: "Tap to share" },
  daily_winner: { title: "You won the day in {packName}",   subtitle: "Tap to share" },
};

// ── Color tint per kind ──────────────────────────────────────────────────
// took_lead + daily_winner → leader amber (rank #1 prestige).
// all_goals → success green (the "did everything" celebration).
function tintForKind(kind: UnpostedAchievementKind): string {
  switch (kind) {
    case "took_lead":    return colors.leader;
    case "daily_winner": return colors.leader;
    case "all_goals":    return C.success;
  }
}

// ── Component ────────────────────────────────────────────────────────────
interface Props {
  achievement: UnpostedAchievement;
  onTap: () => void;
  onDismiss: () => void;
}

export function HomeAchievementBanner({ achievement, onTap, onDismiss }: Props) {
  const tint = tintForKind(achievement.kind);
  const copy = BANNER_COPY[achievement.kind];
  const title = copy.title.replace("{packName}", achievement.packName);

  return (
    <Pressable
      onPress={onTap}
      style={({ pressed }) => [s.card, pressed && s.cardPressed]}
    >
      <View style={[s.tintBar, { backgroundColor: tint }]} />
      <View style={s.content}>
        <Text style={[s.title, { color: tint }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={s.subtitle}>{copy.subtitle}</Text>
      </View>
      <TouchableOpacity
        onPress={onDismiss}
        hitSlop={10}
        style={s.dismissBtn}
        accessibilityLabel="Dismiss"
      >
        <Ionicons name="close" size={20} color={C.textSecondary} />
      </TouchableOpacity>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: C.border,
    marginHorizontal: 16,
    marginBottom: 12,
    overflow: "hidden",
    minHeight: 72,
  },
  cardPressed: {
    opacity: 0.85,
  },
  tintBar: {
    width: 4,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 13,
    color: C.textSecondary,
  },
  dismissBtn: {
    paddingHorizontal: 12,
    justifyContent: "center",
  },
});
