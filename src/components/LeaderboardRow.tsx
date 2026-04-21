import { View, Text, StyleSheet } from "react-native";
import type { LeaderboardEntry } from "../types/database";

interface LeaderboardRowProps {
  entry: LeaderboardEntry;
  isCurrentUser?: boolean;
}

export function LeaderboardRow({ entry, isCurrentUser = false }: LeaderboardRowProps) {
  return (
    <>
      <View style={styles.separator} />
      <View style={styles.row}>
        <View style={styles.left}>
          <Text style={styles.name} numberOfLines={1}>
            {entry.display_name}
          </Text>
          {isCurrentUser && (
            <Text style={styles.you}> (you)</Text>
          )}
        </View>

        <View style={styles.right}>
          <Text style={styles.points}>{entry.total_points} pts</Text>
          {entry.streak_days > 0 && (
            <Text style={styles.streak}>  🔥 {entry.streak_days}</Text>
          )}
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#E5E7EB",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  left: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  name: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  you: {
    fontSize: 13,
    color: "#9CA3AF",
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
  },
  points: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111827",
  },
  streak: {
    fontSize: 13,
    color: "#111827",
  },
});
