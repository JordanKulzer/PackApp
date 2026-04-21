import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";

interface WaterLoggerProps {
  totalOzToday: number;
  targetOz: number;
  onLog: (amountOz: number) => Promise<void>;
  isLoading?: boolean;
}

const QUICK_LOG_OPTIONS = [
  { label: "+8 oz", value: 8, emoji: "🥤" },
  { label: "+16 oz", value: 16, emoji: "🫗" },
  { label: "+32 oz", value: 32, emoji: "🍶" },
];

export function WaterLogger({
  totalOzToday,
  targetOz,
  onLog,
  isLoading = false,
}: WaterLoggerProps) {
  const progress = Math.min(totalOzToday / targetOz, 1);
  const progressPercent = Math.round(progress * 100);
  const isGoalMet = totalOzToday >= targetOz;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>💧 Water</Text>
        <Text style={styles.subtitle}>
          {totalOzToday} / {targetOz} oz
        </Text>
      </View>

      <View style={styles.progressBar}>
        <View
          style={[
            styles.progressFill,
            { width: `${progressPercent}%` },
            isGoalMet && styles.progressFillComplete,
          ]}
        />
      </View>

      {isGoalMet && (
        <Text style={styles.goalMet}>Goal reached! 🎉</Text>
      )}

      <View style={styles.buttons}>
        {QUICK_LOG_OPTIONS.map((option) => (
          <TouchableOpacity
            key={option.value}
            style={styles.button}
            onPress={() => onLog(option.value)}
            disabled={isLoading}
            activeOpacity={0.75}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color="#6366F1" />
            ) : (
              <>
                <Text style={styles.buttonEmoji}>{option.emoji}</Text>
                <Text style={styles.buttonLabel}>{option.label}</Text>
              </>
            )}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 14,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
  },
  subtitle: {
    fontSize: 15,
    color: "#6B7280",
    fontWeight: "500",
  },
  progressBar: {
    height: 10,
    backgroundColor: "#E5E7EB",
    borderRadius: 5,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#6366F1",
    borderRadius: 5,
  },
  progressFillComplete: {
    backgroundColor: "#10B981",
  },
  goalMet: {
    textAlign: "center",
    fontSize: 14,
    fontWeight: "600",
    color: "#10B981",
  },
  buttons: {
    flexDirection: "row",
    gap: 10,
  },
  button: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EEF2FF",
    borderRadius: 14,
    paddingVertical: 14,
    gap: 4,
  },
  buttonEmoji: {
    fontSize: 22,
  },
  buttonLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#4F46E5",
  },
});
