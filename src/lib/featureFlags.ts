export const FEATURE_FLAGS = {
  // Shelved 2026-04-24: didn't want daily winner to outshine weekly winner
  // (the actual product). Plumbing preserved — flip to true to revive, but
  // polish VictoryPostSheet and Home banner visuals first.
  dailyWinner: false,
} as const;
