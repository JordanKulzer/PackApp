// StreakLine — single-line streak presentation (Pass 22).
//
// Renders: 🔥 {N} day streak [· 🏆 best {M}].
//   - Active streak (currentStreak > 0): flame in danger red, text primary.
//   - Broken streak (currentStreak === 0): flame in tertiary gray, text
//     tertiary gray.
//   - Best suffix appears only when bestStreak > 0 — never celebrate a
//     never-existed best.
//
// Pure presentation. Callers pass already-computed streak values; no
// queries, no internal computation.
//
// Consumers:
//   - app/(app)/profile/index.tsx       (self-view: AllTimeStats values)
//   - app/user/[id].tsx                 (public view: RPC response values)

import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { userProfile, t } from "../../constants/strings";

const C = {
  textPrimary: "#E6EDF3",
  textSecondary: "#8B949E",
  textTertiary: "#484F58",
  danger: "#F85149",
} as const;

interface StreakLineProps {
  currentStreak: number;
  bestStreak: number;
}

export function StreakLine({ currentStreak, bestStreak }: StreakLineProps) {
  const active = currentStreak > 0;
  return (
    <View style={s.row}>
      <Ionicons
        name="flame"
        size={16}
        color={active ? C.danger : C.textTertiary}
      />
      <Text style={[s.text, !active && s.textBroken]}>
        {t(userProfile.streakLine.dayStreak, { count: currentStreak })}
      </Text>
      {bestStreak > 0 && (
        <>
          <Text style={s.dot}> · </Text>
          <Ionicons name="trophy-outline" size={14} color={C.textSecondary} />
          <Text style={s.best}>
            {t(userProfile.streakLine.bestSuffix, { count: bestStreak })}
          </Text>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 4,
  },
  text: {
    fontSize: 14,
    fontWeight: "600",
    color: C.textPrimary,
  },
  textBroken: {
    color: C.textTertiary,
  },
  dot: {
    fontSize: 14,
    color: C.textSecondary,
  },
  best: {
    fontSize: 14,
    color: C.textSecondary,
    fontWeight: "500",
  },
});
