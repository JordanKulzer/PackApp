// Shared pack-config helpers. Extracted from src/components/PackGridView.tsx
// so consumers outside the Compete tab (e.g. the public profile screen's
// Trends section) can reuse the same enable-flag logic without depending
// on — or duplicating — Compete-tab internals.

import type { Pack } from "../types/database";
import { CATEGORIES, type Category } from "./categories";

// pack enable-flags aren't keyed by Category — map explicitly. The exhaustive
// switch means adding a Category surfaces a compile error here.
export function categoryEnabled(pack: Pack, category: Category): boolean {
  switch (category) {
    case "steps":
      return pack.steps_enabled;
    case "workouts":
      return pack.workouts_enabled;
    case "calories":
      return pack.calories_enabled;
    case "water":
      return pack.water_enabled;
  }
}

// Convenience: filtered subset of CATEGORIES for a given pack. Preserves
// CATEGORIES order (steps → workouts → calories → water) so the left-to-
// right visual order stays stable across consumers; disabled entries just
// drop out.
export function getEnabledCategories(pack: Pack): Category[] {
  return CATEGORIES.filter((c) => categoryEnabled(pack, c));
}
