import { create } from "zustand";

// Mirrors the fields PackScreen needs for a MemberScore row,
// minus user_id / display_name which are derived elsewhere.
export interface OptimisticScore {
  weekly_points: number; // full run total — drives ring animation and ranking
  total_points: number;  // today only — drives Today section and goal bars
  streak_days: number;
  steps_achieved: boolean;
  workout_achieved: boolean;
  calories_achieved: boolean;
  water_achieved: boolean;
  steps_count: number;
  calories_count: number;
  water_oz_count: number;
  workout_count: number;
}

export function emptyOptimisticScore(): OptimisticScore {
  return {
    weekly_points: 0,
    total_points: 0,
    streak_days: 0,
    steps_achieved: false,
    workout_achieved: false,
    calories_achieved: false,
    water_achieved: false,
    steps_count: 0,
    calories_count: 0,
    water_oz_count: 0,
    workout_count: 0,
  };
}

interface ScoreState {
  // Keyed by packId — one entry per pack the user has logged in this session
  myScores: Record<string, OptimisticScore>;
  // Monotonically increasing; screens watch this to re-fetch after a log
  logVersion: number;
  patchMyScore: (packId: string, patch: Partial<OptimisticScore>) => void;
  bumpLogVersion: () => void;
}

export const useScoreStore = create<ScoreState>((set) => ({
  myScores: {},
  logVersion: 0,
  patchMyScore: (packId, patch) =>
    set((state) => ({
      myScores: {
        ...state.myScores,
        [packId]: {
          ...(state.myScores[packId] ?? emptyOptimisticScore()),
          ...patch,
        },
      },
    })),
  bumpLogVersion: () =>
    set((state) => ({ logVersion: state.logVersion + 1 })),
}));
