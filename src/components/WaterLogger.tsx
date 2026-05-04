import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { BrandColors } from "../constants/brand";

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
              <ActivityIndicator size="small" color={BrandColors.blue} />
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
    color: BrandColors.ink,
  },
  subtitle: {
    fontSize: 15,
    color: BrandColors.inkMuted,
    fontWeight: "500",
  },
  // Progress track on the dark surface — borderStrong gives just enough
  // contrast to see the empty track without competing with the fill.
  progressBar: {
    height: 10,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 5,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: BrandColors.blue,
    borderRadius: 5,
  },
  progressFillComplete: {
    backgroundColor: BrandColors.success,
  },
  goalMet: {
    textAlign: "center",
    fontSize: 14,
    fontWeight: "600",
    color: BrandColors.success,
  },
  buttons: {
    flexDirection: "row",
    gap: 10,
  },
  // Quick-log buttons sit on the dark card, so the chip surface is a
  // subtle blue-tinted overlay rather than the previous bright #EEF2FF.
  button: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(59, 130, 246, 0.10)",
    borderRadius: 14,
    paddingVertical: 14,
    gap: 4,
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.20)",
  },
  buttonEmoji: {
    fontSize: 22,
  },
  buttonLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: BrandColors.blueSoft,
  },
});
