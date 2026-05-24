// StreakLine — single-line streak presentation (Pass 22).
//
// Renders: ⚡ {N} day streak [· 🏆 Top streak: {M}].
//   - Active streak (currentStreak > 0): lightning-bolt in C.streak orange,
//     text primary. Matches the app's streak convention everywhere else
//     (PackGridView Compete row + LogSheet streak module). Flame was
//     swapped out because it collides with the "calories" category icon
//     (which is fire).
//   - Broken streak (currentStreak === 0): lightning-bolt in tertiary
//     gray, text tertiary gray.
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
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { userProfile, t } from "../../constants/strings";

const C = {
  textPrimary: "#E6EDF3",
  textSecondary: "#8B949E",
  textTertiary: "#484F58",
  // App's streak/accomplishment accent — matches PackGridView + LogSheet.
  streak: "#FF9500",
} as const;

interface StreakLineProps {
  currentStreak: number;
  bestStreak: number;
}

export function StreakLine({ currentStreak, bestStreak }: StreakLineProps) {
  const active = currentStreak > 0;
  return (
    <View style={s.row}>
      <MaterialCommunityIcons
        name="lightning-bolt"
        size={16}
        color={active ? C.streak : C.textTertiary}
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
