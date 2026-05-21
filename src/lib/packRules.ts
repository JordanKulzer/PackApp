import { WORKOUT_MAX_DAILY } from "./scoring";
import { FEATURE_FLAGS } from "./featureFlags";
import type { Pack } from "../types/database";

export type RuleActivity = {
  type: "steps" | "workout" | "calories" | "water";
  label: string;
  enabled: boolean;
  goalThreshold: number | null;
  goalDisplay: string;
  dailyMax?: number;
};

export type SpecialEvent = {
  key: "took_lead" | "all_goals" | "daily_winner";
  name: string;
  description: string;
  enabled: boolean;
};

export type PackRules = {
  activities: RuleActivity[];
  window: "weekly" | "monthly";
  specialEvents: SpecialEvent[];
};

export function getPackRules(pack: Pack): PackRules {
  const enabledGoalCount = [
    pack.steps_enabled,
    pack.workouts_enabled,
    pack.calories_enabled,
    pack.water_enabled,
  ].filter(Boolean).length;

  return {
    activities: [
      {
        type: "steps",
        label: "Steps",
        enabled: pack.steps_enabled,
        goalThreshold: pack.steps_enabled ? pack.step_target : null,
        goalDisplay: pack.steps_enabled
          ? `${pack.step_target.toLocaleString()} steps`
          : "Off",
      },
      {
        type: "workout",
        label: "Workout",
        enabled: pack.workouts_enabled,
        goalThreshold: pack.workouts_enabled ? 1 : null,
        goalDisplay: pack.workouts_enabled ? "1+ workout" : "Off",
        dailyMax: WORKOUT_MAX_DAILY,
      },
      {
        type: "calories",
        label: "Calories",
        enabled: pack.calories_enabled,
        goalThreshold: pack.calories_enabled ? pack.calorie_target : null,
        goalDisplay: pack.calories_enabled ? `${pack.calorie_target} cal` : "Off",
      },
      {
        type: "water",
        label: "Water",
        enabled: pack.water_enabled,
        goalThreshold: pack.water_enabled ? pack.water_target_oz : null,
        goalDisplay: pack.water_enabled
          ? `${pack.water_target_oz} oz`
          : "Off",
      },
    ],
    window: pack.competition_window,
    specialEvents: [
      {
        key: "took_lead",
        name: "Took the lead",
        description:
          "Become #1 on the weekly leaderboard (strict — ties don't count).",
        enabled: true,
      },
      {
        key: "all_goals",
        name: "All goals",
        description:
          "Hit every enabled goal in one day. Needs at least 2 enabled goals.",
        enabled: enabledGoalCount >= 2,
      },
      {
        key: "daily_winner",
        name: "Daily winner",
        description: "Won the most categories that day.",
        enabled: FEATURE_FLAGS.dailyWinner,
      },
    ],
  };
}
