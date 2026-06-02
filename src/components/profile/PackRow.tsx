// PackRow — Shared-packs section row primitive (Pass 22, lifted from
// Pass 21d's inline definition in app/user/[id].tsx).
//
// Anatomy: [pack name (flex)][colored signal text].
// Tappable — caller wires onPress. The deep-link sequence
// (cancelOnNav → router.dismiss → router.push) lives in the parent
// screen's handler; PackRow only knows "rendered, when tapped fire onPress."
//
// Visual states (other-view):
//   - viewer ahead     → "You +{n}"           (success green)
//   - viewer behind    → "Behind {n}"         (danger red)
//   - tied             → "Tied"               (secondary gray)
//   - no active run    → "No active run"      (tertiary gray)
//
// Visual states (self-view):
//   - has active run   → "{rank}{ord} of {n}" (secondary gray, no color
//                                             coding — color is reserved
//                                             for the head-to-head signal)
//   - no active run    → "No active run"      (tertiary gray)
//
// Consumers:
//   - app/user/[id].tsx                 (public profile shared-packs list)

import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { userProfile, t } from "../../constants/strings";
import type { CompetitionWindow } from "../../types/database";

const C = {
  border: "#30363D",
  textPrimary: "#E6EDF3",
  textSecondary: "#8B949E",
  textTertiary: "#484F58",
  danger: "#F85149",
  success: "#3FB950",
} as const;

export interface SharedPackDetail {
  pack_id: string;
  pack_name: string;
  has_active_run: boolean;
  // Points-based fields — added by an earlier RPC extension but now DEAD
  // metric (daily_scores.total_points has no writer since the Categories
  // Pivot Stage 2A removed the scoring helpers; column is NOT NULL
  // DEFAULT 0). Kept in the type because the RPC still returns them
  // until the points→wins sweep removes them server-side. **No UI
  // surface should read these** — use the wins fields below.
  viewer_points: number;
  target_points: number;
  viewer_rank: number; // 1-indexed; 0 when no active run
  target_rank: number;
  target_today_points: number;
  // Wins-based fields — the LIVE metric. Aggregated server-side from
  // daily_winners over the active run (excludes 'legacy' category to
  // mirror rollover_expired_runs + usePackCategoryStandings). Drives
  // the profile sheet's "this week" block + the Shared-packs
  // head-to-head delta. Added by migration
  // 20260601c_profile_wins_fields.sql.
  viewer_wins: number;
  target_wins: number;
  viewer_wins_rank: number; // 1-indexed; 0 when no active run
  target_wins_rank: number;
  // Pack's competition window — used to label the run-total stat on the
  // profile pack-context summary ("This week" / "This month"). Optional
  // at the type level because the RPC field is added via migration
  // 20260601b_profile_competition_window.sql which is review-only —
  // until applied, the field is absent on rows and consumers must
  // default. Once applied, every row carries it.
  competition_window?: CompetitionWindow;
  member_count: number;
}

// English ordinal suffix for self-rank format (Pass 21d).
// 1 → "st", 2 → "nd", 3 → "rd", 4-20 → "th", 21 → "st", 22 → "nd", …
function ordinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

interface PackRowProps {
  row: SharedPackDetail;
  isSelf: boolean;
  onPress: () => void;
}

export function PackRow({ row, isSelf, onPress }: PackRowProps) {
  let signalText: string;
  let signalColor: string;

  if (!row.has_active_run) {
    signalText = userProfile.headToHead.noActiveRun;
    signalColor = C.textTertiary;
  } else if (isSelf) {
    // Self-view rank uses the wins-based rank now — same LIVE metric
    // as Compete/standings. The viewer_wins_rank ordinal is correct
    // when the viewer has wins; 0 (no active run) was already filtered
    // by the `has_active_run` branch above. The self-view doesn't
    // need an allZeroWins "—" guard because the rank-of-N format
    // ("2nd of 5") reads sensibly even at zero wins (the leftmost
    // tie shows as "1st of N"); the head-to-head deltas below are
    // where the all-zero noise would have shown.
    signalText = t(userProfile.headToHead.selfRank, {
      rank: row.viewer_wins_rank,
      ord: ordinalSuffix(row.viewer_wins_rank),
      count: row.member_count,
    });
    signalColor = C.textSecondary;
  } else if (row.viewer_wins > row.target_wins) {
    const delta = row.viewer_wins - row.target_wins;
    signalText = t(userProfile.headToHead.ahead, {
      count: delta,
      unit: delta === 1 ? "win" : "wins",
    });
    signalColor = C.success;
  } else if (row.viewer_wins < row.target_wins) {
    const delta = row.target_wins - row.viewer_wins;
    signalText = t(userProfile.headToHead.behind, {
      count: delta,
      unit: delta === 1 ? "win" : "wins",
    });
    signalColor = C.danger;
  } else {
    signalText = userProfile.headToHead.tied;
    signalColor = C.textSecondary;
  }

  return (
    <TouchableOpacity
      style={s.row}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
    >
      <Text style={s.name} numberOfLines={1}>
        {row.pack_name}
      </Text>
      <Text style={[s.signal, { color: signalColor }]}>{signalText}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  name: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: C.textPrimary,
  },
  signal: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "right",
  },
});
