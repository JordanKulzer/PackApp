import React from "react";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { CATEGORY_ICON, type Category } from "../lib/categories";

// Renders the category icon from the centralized CATEGORY_ICON map
// (single source of truth in src/lib/categories.ts). Branches on the
// map's `lib` field to pick the right @expo/vector-icons family.
// Lifted from PackGridView so per-category surfaces across the app
// (Compete row, WeekDetailSheet Category Champions / day-badges,
// Recap Category Champions) can share a single implementation.
//
// Defaults to size 14 + caller-provided color. `color` is required so
// every consumer makes an explicit choice (gold/leader for celebration
// surfaces, textSecondary for neutral labelling).
export function CategoryIcon({
  category,
  size = 14,
  color,
}: {
  category: Category;
  size?: number;
  color: string;
}) {
  const meta = CATEGORY_ICON[category];
  if (meta.lib === "Ionicons") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return <Ionicons name={meta.name as any} size={size} color={color} />;
  }
  return (
    <MaterialCommunityIcons
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      name={meta.name as any}
      size={size}
      color={color}
    />
  );
}
