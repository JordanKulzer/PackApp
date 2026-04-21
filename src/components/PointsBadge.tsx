import { View, Text, StyleSheet } from "react-native";
import { colors } from "../theme/colors";

interface PointsBadgeProps {
  points: number;
  size?: "sm" | "md" | "lg";
  highlight?: boolean;
}

export function PointsBadge({ points, size = "md", highlight = false }: PointsBadgeProps) {
  const isSmall = size === "sm";
  const isLarge = size === "lg";

  return (
    <View
      style={[
        styles.badge,
        highlight && styles.highlight,
        isSmall && styles.small,
        isLarge && styles.large,
      ]}
    >
      <Text
        style={[
          styles.points,
          highlight && styles.pointsHighlight,
          isSmall && styles.pointsSmall,
          isLarge && styles.pointsLarge,
        ]}
      >
        {points.toLocaleString()}
      </Text>
      <Text
        style={[
          styles.label,
          highlight && styles.labelHighlight,
          isSmall && styles.labelSmall,
          isLarge && styles.labelLarge,
        ]}
      >
        pts
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 2,
    backgroundColor: "#F3F4F6",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  highlight: {
    backgroundColor: colors.self,
  },
  small: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 7,
  },
  large: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
  },
  points: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111827",
  },
  pointsHighlight: {
    color: "#FFF",
  },
  pointsSmall: {
    fontSize: 12,
  },
  pointsLarge: {
    fontSize: 20,
  },
  label: {
    fontSize: 11,
    fontWeight: "500",
    color: "#6B7280",
  },
  labelHighlight: {
    color: "rgba(255,255,255,0.8)",
  },
  labelSmall: {
    fontSize: 9,
  },
  labelLarge: {
    fontSize: 14,
  },
});
