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
  self:         "#2F81F7",               // blue — current user
  selfBgDim:    "rgba(47,129,247,0.06)", // subtle self-row highlight
  selfBgSubtle: "rgba(47,129,247,0.08)", // medium self-row highlight
  selfBgLight:  "rgba(47,129,247,0.15)", // light self-badge background
  member:       "#8B949E",               // neutral grey — all other members (ring + name)
  accent:       "#2563EB",               // UI chrome: buttons, toggles, active states
} as const;
