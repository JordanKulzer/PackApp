// Single source of truth for category identifiers.
//
// Adding a new category means:
//   (1) add it to the CATEGORIES array here,
//   (2) update the SQL CHECK constraints in the daily_winners +
//       run_category_winners migrations,
//   (3) update CATEGORY_LABELS + CATEGORY_DAILY_SCORE_COLUMN + CATEGORY_ICON below.
// TypeScript will surface any other site that needs an update.

export const CATEGORIES = ["steps", "workouts", "calories", "water"] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  steps: "Steps",
  workouts: "Workouts",
  calories: "Calories",
  water: "Water",
};

// Maps Category to the daily_scores column that holds its metric value.
// Used by hooks reading per-category data live.
export const CATEGORY_DAILY_SCORE_COLUMN: Record<
  Category,
  "steps_count" | "workout_count" | "calories_count" | "water_oz_count"
> = {
  steps: "steps_count",
  workouts: "workout_count",
  calories: "calories_count",
  water: "water_oz_count",
};

// Per-category icon set — single source of truth.
//
// Sourced from the de-facto convention in the Profile + public-user-
// profile Lifetime Stats sections (steps=shoe-print, workouts=dumbbell,
// calories=fire, water=water). Centralized here so future surfaces
// consume one map; the two profile screens still inline their own
// icons today (future cleanup, intentionally out of scope for the
// Compete-row redesign that introduced this map).
//
// `lib` selects the icon family from @expo/vector-icons. Consumers
// branch on it and render the corresponding component with their own
// size/color (e.g. small inline for member rows, larger for list rows).
export const CATEGORY_ICON: Record<
  Category,
  { lib: "MaterialCommunityIcons" | "Ionicons"; name: string }
> = {
  steps: { lib: "MaterialCommunityIcons", name: "shoe-print" },
  workouts: { lib: "MaterialCommunityIcons", name: "dumbbell" },
  calories: { lib: "MaterialCommunityIcons", name: "fire" },
  water: { lib: "Ionicons", name: "water" },
};
