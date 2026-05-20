import { View, Text, StyleSheet } from "react-native";

interface StreakBadgeProps {
  days: number;
  size?: "sm" | "md" | "lg";
}

function getStreakColor(days: number): string {
  if (days >= 7) return "#FF4500";
  if (days >= 5) return "#FF8C00";
  if (days >= 3) return "#FFA500";
  return "#6B7280";
}

export function StreakBadge({ days, size = "md" }: StreakBadgeProps) {
  if (days === 0) return null;

  const color = getStreakColor(days);
  const isSmall = size === "sm";
  const isLarge = size === "lg";

  return (
    <View style={[styles.badge, { backgroundColor: color }, isSmall && styles.small, isLarge && styles.large]}>
      <Text style={[styles.fire, isSmall && styles.fireSmall, isLarge && styles.fireLarge]}>
        🔥
      </Text>
      <Text style={[styles.days, isSmall && styles.daysSmall, isLarge && styles.daysLarge]}>
        {days}d
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    gap: 2,
  },
  small: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 8,
  },
  large: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
  },
  fire: {
    fontSize: 13,
  },
  fireSmall: {
    fontSize: 10,
  },
  fireLarge: {
    fontSize: 18,
  },
  days: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFF",
  },
  daysSmall: {
    fontSize: 11,
  },
  daysLarge: {
    fontSize: 17,
  },
});
