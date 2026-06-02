// Pending-category-change banner — Phase 2.5.
//
// Shows on Pack Detail (above the InScreenTabBar so it appears on every
// tab) while a pack has any queued category-enable change. The rollover
// RPC clears pending_*_enabled to NULL when the run ends, so the next
// pack data fetch after rollover hides the banner automatically — purely
// state-driven, no manual dismiss.
//
// Pack-visible (not owner-only) by design: members benefit from knowing
// scoring will change at rollover. No alarm styling — informational tint.
//
// Copy construction is non-trivial (counts, directions, list joins), so
// the English fragments live inline here rather than in strings.ts. The
// period word ("week" / "month") comes off pack.competition_window.

import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Pack } from "../types/database";
import {
  dismissBanner,
  getDismissedTimestamp,
} from "../lib/pendingBannerDismissal";

interface Props {
  pack: Pack;
}

type CategoryDir = { name: string; direction: "on" | "off" };

// Category display names — match the labels used elsewhere (Create Pack /
// Edit Pack toggles). Lowercased forms used mid-sentence in joins.
const NAMES = {
  steps: "Steps",
  workouts: "Workouts",
  calories: "Active Calories",
  water: "Water",
} as const;

function buildChanges(pack: Pack): CategoryDir[] {
  const changes: CategoryDir[] = [];
  if (pack.pending_steps_enabled !== null) {
    changes.push({
      name: NAMES.steps,
      direction: pack.pending_steps_enabled ? "on" : "off",
    });
  }
  if (pack.pending_workouts_enabled !== null) {
    changes.push({
      name: NAMES.workouts,
      direction: pack.pending_workouts_enabled ? "on" : "off",
    });
  }
  if (pack.pending_calories_enabled !== null) {
    changes.push({
      name: NAMES.calories,
      direction: pack.pending_calories_enabled ? "on" : "off",
    });
  }
  if (pack.pending_water_enabled !== null) {
    changes.push({
      name: NAMES.water,
      direction: pack.pending_water_enabled ? "on" : "off",
    });
  }
  return changes;
}

// Joins names for the same-direction sentence: "A", "A and B", or
// "A, B, and C" (Oxford comma). First name keeps its display casing
// (sentence-start position); subsequent names are lowercased so the
// sentence reads naturally in the middle ("Steps and water tracking…").
function joinNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  const first = names[0];
  const rest = names.slice(1).map((n) => n.toLowerCase());
  if (rest.length === 1) return `${first} and ${rest[0]}`;
  return `${first}, ${rest.slice(0, -1).join(", ")}, and ${rest[rest.length - 1]}`;
}

function buildCopy(changes: CategoryDir[], period: "week" | "month"): string {
  if (changes.length === 0) return "";

  const offs = changes.filter((c) => c.direction === "off");
  const ons = changes.filter((c) => c.direction === "on");

  // Mixed directions → enumerate inline. "Category changes apply next
  // week: steps on, water off." All names lowercased since they appear
  // mid-list, not at sentence start.
  if (offs.length > 0 && ons.length > 0) {
    const items = [
      ...ons.map((c) => `${c.name.toLowerCase()} on`),
      ...offs.map((c) => `${c.name.toLowerCase()} off`),
    ];
    return `Category changes apply next ${period}: ${items.join(", ")}.`;
  }

  // Single direction — verb agrees with category count.
  const direction = offs.length > 0 ? "off" : "on";
  const list = offs.length > 0 ? offs : ons;
  const verb = list.length === 1 ? "turns" : "turn";
  const subject = joinNames(list.map((c) => c.name));
  return `${subject} tracking ${verb} ${direction} next ${period}.`;
}

export function PendingCategoryBanner({ pack }: Props) {
  // Per-pack dismissal — value stored = pack.pending_changes_at at
  // dismiss time. Keyed on pack.id; null on first mount until the
  // AsyncStorage read resolves (banner is briefly visible if it would
  // otherwise be dismissed — acceptable; the read is a single tick).
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getDismissedTimestamp(pack.id).then((v) => {
      if (!cancelled) setDismissedAt(v);
    });
    return () => {
      cancelled = true;
    };
  }, [pack.id]);

  const changes = buildChanges(pack);
  if (changes.length === 0) return null;

  // Dismissal gate — suppress ONLY when the user previously dismissed
  // THIS exact notice instance (matched by pending_changes_at). A new
  // pending change refreshes pending_changes_at, the stored value no
  // longer matches, and the banner re-shows automatically.
  if (
    pack.pending_changes_at != null &&
    dismissedAt === pack.pending_changes_at
  ) {
    return null;
  }

  const period = pack.competition_window === "monthly" ? "month" : "week";
  const text = buildCopy(changes, period);

  const onDismiss = () => {
    if (pack.pending_changes_at == null) return;
    // Optimistic local hide + persisted dismissal. The async write is
    // fire-and-forget (fail-silent in the helper); local state hides
    // the banner immediately so the tap is responsive.
    setDismissedAt(pack.pending_changes_at);
    void dismissBanner(pack.id, pack.pending_changes_at);
  };

  return (
    <View style={s.wrap}>
      <Text style={s.text}>{text}</Text>
      <TouchableOpacity
        onPress={onDismiss}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        style={s.dismissBtn}
      >
        <Ionicons name="close" size={20} color="#8B949E" />
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  // Informational tint — surfaceRaised against the dark page bg, NOT
  // an error red. Slim vertical padding so it doesn't push the tab bar
  // far down; horizontal padding matches the screen's 16pt content
  // gutter.
  wrap: {
    backgroundColor: "#1C2333",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "#30363D",
    paddingHorizontal: 16,
    paddingVertical: 10,
    // Row layout so the dismiss X sits at the right edge while the
    // notice text takes the remaining width.
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  text: {
    flex: 1,
    fontSize: 13,
    color: "#E6EDF3",
    lineHeight: 18,
  },
  dismissBtn: {
    // Square slot for the close icon; padding adds a touch of
    // breathing room without expanding the band's vertical footprint
    // (band's paddingVertical:10 already centers the 20px icon).
    padding: 2,
  },
});
