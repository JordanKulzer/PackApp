export const FEATURE_FLAGS = {
  // Shelved 2026-04-24: didn't want daily winner to outshine weekly winner
  // (the actual product). NOT the categories-pivot gate — see categoriesPivot
  // below. Its original shelved-feature semantics still apply: filters
  // daily_winner activity_feed rows out of useActivityFeed / usePackTimeline,
  // and gates the RulesSheet daily-winner event row. The daily-winners RPC
  // trigger no longer gates on this flag.
  dailyWinner: false,
  // Categories pivot (2026-05-19): gates which leaderboard UI renders (new
  // per-category vs legacy points). Backend always computes daily_winners
  // now — this flag is UI-only. Flip to true to expose the new leaderboard.
  categoriesPivot: false,
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
  // 2026-05-24: Per-pack run-rollover recap trigger. When ON, opening a
  // pack whose active run rolled over since the user last opened it (on
  // this device) navigates to the recap once. Default OFF — flip after a
  // dogfood pass. Helpers: src/lib/newRunRecap.ts. Trigger lives in
  // app/(app)/pack/[id].tsx.
  newRunRecap: false,
} as const;
