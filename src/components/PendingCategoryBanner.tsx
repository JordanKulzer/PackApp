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

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { Pack } from "../types/database";

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
  const changes = buildChanges(pack);
  if (changes.length === 0) return null;
  const period = pack.competition_window === "monthly" ? "month" : "week";
  const text = buildCopy(changes, period);
  return (
    <View style={s.wrap}>
      <Text style={s.text}>{text}</Text>
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
  },
  text: {
    fontSize: 13,
    color: "#E6EDF3",
    lineHeight: 18,
  },
});
