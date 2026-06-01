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
  viewer_points: number;
  target_points: number;
  viewer_rank: number; // 1-indexed; 0 when no active run
  // Target's rank in the active run (1-indexed; 0 when no active run).
  // Mirrors viewer_rank but for the profile's subject. Consumed by the
  // pack-context summary block in app/user/[id].tsx.
  target_rank: number;
  // Target's points on the active run's "today" (pack-timezone date).
  // 0 is meaningful (logged nothing today vs. logged & scored 0).
  target_today_points: number;
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
    signalText = t(userProfile.headToHead.selfRank, {
      rank: row.viewer_rank,
      ord: ordinalSuffix(row.viewer_rank),
      count: row.member_count,
    });
    signalColor = C.textSecondary;
  } else if (row.viewer_points > row.target_points) {
    signalText = t(userProfile.headToHead.ahead, {
      count: row.viewer_points - row.target_points,
    });
    signalColor = C.success;
  } else if (row.viewer_points < row.target_points) {
    signalText = t(userProfile.headToHead.behind, {
      count: row.target_points - row.viewer_points,
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
