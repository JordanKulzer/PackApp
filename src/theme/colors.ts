// Semantic color tokens for PackApp
//
// Ring identity rule (codified in PackMemberDisplay — do not duplicate):
//   1. Leader (#1 rank)  → colors.leader for ring arc + initial
//   2. Current user      → colors.self   for ring arc + initial (unless they are the leader)
//   3. Everyone else     → colors.member for ring arc + initial
//
// Name label rule:
//   Current user → colors.self; everyone else → colors.member
//
// colors.member must be visible against the dark track ring (#30363D) so
// arc progress reads clearly for non-leader/non-self members.
//
// colors.accent  = UI chrome only (buttons, toggles, active filter chips) — NOT a
//                  semantic identity color; do not use for leader or self indicators.

export const colors = {
  leader:       "#E3A000",               // amber/gold — whoever is #1
  leaderBg:     "#2A1D00",               // dark container bg for leader badge
  leaderBorder: "#B07D00",               // border for leader badge container
  self:         "#2F81F7",               // blue — current user (NAME color on rows)
  // selfBgDim / selfBgLight are RETAINED for non-self-identity uses:
  // selfBgDim → cardPro background, selfBgLight → "Active" badge bg.
  // The earlier selfBgSubtle (0.08) is gone — its only consumer was the
  // History tab self-row tint, which was removed in the app-wide
  // self-highlight consolidation (name-color is the single treatment).
  selfBgDim:    "rgba(47,129,247,0.06)",
  selfBgLight:  "rgba(47,129,247,0.15)",
  member:       "#8B949E",               // neutral grey — all other members (ring + name)
  // Neutral fill for non-leader PROGRESS BARS — same slate family as the
  // bar track (#1F2937) so the fill reads as "fill, not identity." Pulled
  // out as its own token to keep colors.self / colors.accent reserved for
  // their actual semantic roles (self-identity / UI chrome) instead of
  // doubling as bar decoration.
  barNeutral:   "#4B5563",
  accent:       "#2563EB",               // UI chrome: buttons, toggles, active states
} as const;
