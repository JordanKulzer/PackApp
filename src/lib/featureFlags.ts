export const FEATURE_FLAGS = {
  // Shelved 2026-04-24: didn't want daily winner to outshine weekly winner
  // (the actual product). Plumbing preserved — flip to true to revive, but
  // polish VictoryPostSheet and Home banner visuals first. Gates daily_winner
  // row visibility (useActivityFeed / usePackTimeline), useUnpostedWins
  // activation, and computeDailyWinnersForPack execution.
  dailyWinner: false,
  // Pass C-revised (2026-05-13): shelved alongside the celebration sheet.
  // The HomeAchievementBanner + VictoryPostSheet flow is product-locked off;
  // achievement events surface as plain feed rows + push notifications now.
  // Pre-shelve this flag gated only the legacy banner queue + VictoryPostSheet
  // auto-open — now subordinate to achievementCelebrationSheet below. Kept
  // as a `true` constant so internal queue logic (useUnpostedAchievements)
  // continues populating; consumers gate on achievementCelebrationSheet to
  // suppress the UI surface. Flip both to revive.
  achievementPrompts: true,
  // Pass C-revised: master flag for the achievement-celebration UX
  // (HomeAchievementBanner + auto-opening VictoryPostSheet). Off by default —
  // see Pass C-revised brief. Push notifications for took_lead / all_goals
  // continue firing from competitiveDetection.ts independently; only the
  // in-app celebration sheet + banner are suppressed here.
  achievementCelebrationSheet: false,
} as const;
