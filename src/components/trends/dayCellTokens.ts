// Single-sourced day-cell visual language. Shared by:
//   • Compete week-row (DailyWinnerStrip) — winner-indicator + chart driver
//   • WeekDetailModal "Daily Breakdown" picker — drives selectedDay for the
//     per-member detail rows below
//
// The two cells carry DIFFERENT data (winner chip vs. day-name label +
// activity-bar underline) but should LOOK THE SAME so the app's day-cell
// language is consistent. This module exposes only the VISUAL tokens
// (padding, radius, ring widths, color tiers); each consumer keeps its own
// JSX + state semantics. Change the look here once, both surfaces update.
//
// Values mirror DailyWinnerStrip's prior inline constants byte-for-byte —
// the strip's refactor (moving its inline styles to consume this module)
// proves the tokens match its established look.

import { StyleSheet } from "react-native";
import { colors } from "../../theme/colors";

// Local color tokens — duplicated here so this module is self-contained
// (no theme import beyond colors.self). Values match the `C.*` family
// inlined at the top of every screen + DailyWinnerStrip's own
// SURFACE_RAISED / TEXT_PRIMARY / TEXT_SECONDARY / TERTIARY_TEXT.
const SURFACE_RAISED = "#1C2333";
const TEXT_PRIMARY = "#E6EDF3";
const TEXT_SECONDARY = "#8B949E";
const TERTIARY_TEXT = "#484F58";

// Cell layout constants. cellGap is the row's gap-between-cells (used by
// row containers in each consumer); the rest are cell-internal.
export const DAY_CELL = {
  radius: 10,
  paddingHorizontal: 4,
  paddingVertical: 8,
  cellGap: 5,
} as const;

// Cell visual states. Each consumer composes these onto its own
// TouchableOpacity via style={[dayCellStyles.base, isToday &&
// dayCellStyles.today, ...]} — same shape DailyWinnerStrip already uses
// internally.
//
// Token rules:
//   • base       — default settled/past treatment (surfaceRaised fill,
//                  transparent border slot so the selected-blue overlay
//                  doesn't shift layout when applied)
//   • today      — neutral bright RING + transparent bg (NOT gold/blue,
//                  which carry reserved meanings)
//   • future     — thin tertiary outline + transparent bg (faint)
//   • selected   — self-blue border overlay, stacks on any state
//   • dateNum*   — three text-color tiers matching the state semantics
export const dayCellStyles = StyleSheet.create({
  base: {
    paddingHorizontal: DAY_CELL.paddingHorizontal,
    paddingVertical: DAY_CELL.paddingVertical,
    borderRadius: DAY_CELL.radius,
    backgroundColor: SURFACE_RAISED,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  today: {
    backgroundColor: "transparent",
    borderWidth: 2,
    borderColor: TEXT_PRIMARY,
  },
  future: {
    backgroundColor: "transparent",
    borderColor: TERTIARY_TEXT,
  },
  selected: {
    borderWidth: 1.5,
    borderColor: colors.self,
  },
  dateNum: {
    fontSize: 14,
    fontWeight: "700",
    color: TEXT_SECONDARY,
  },
  dateNumToday: {
    color: TEXT_PRIMARY,
  },
  dateNumFuture: {
    color: TERTIARY_TEXT,
  },
});
