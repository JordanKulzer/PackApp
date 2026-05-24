import { create } from "zustand";

// Mirrors the fields PackScreen needs for a MemberScore row,
// minus user_id / display_name which are derived elsewhere.
//
// Prompt 1 (streak read-site migration): streak_days dropped — PackScreen's
// Compete row reads users.current_streak via the pack_members→users join.
// Goal-removal Part 3b: *_achieved fields dropped — the booleans are no
// longer written by the sync paths and were never read off this shape
// by any UI consumer.
export interface OptimisticScore {
  steps_count: number;
  calories_count: number;
  water_oz_count: number;
  workout_count: number;
}

export function emptyOptimisticScore(): OptimisticScore {
  return {
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
