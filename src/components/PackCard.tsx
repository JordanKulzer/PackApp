import { useState, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import type { Pack } from "../types/database";
import type { LeaderboardEntry } from "../types/database";
import { LeaderboardRow } from "./LeaderboardRow";
import { getTimeUntilReset } from "../lib/scoring";

interface PackCardProps {
  pack: Pack;
  memberCount: number;
  topEntries?: LeaderboardEntry[];
  currentUserId?: string;
  onPress?: () => void;
}

export function PackCard({
  pack,
  memberCount,
  topEntries = [],
  currentUserId,
  onPress,
}: PackCardProps) {
  const [resetInfo, setResetInfo] = useState(() => getTimeUntilReset());

  useEffect(() => {
    const id = setInterval(() => setResetInfo(getTimeUntilReset()), 60_000);
    return () => clearInterval(id);
  }, []);

  const totalHours = resetInfo.days * 24 + resetInfo.hours;
  const totalMinutes = totalHours * 60 + resetInfo.minutes;
  const chipColor =
    totalMinutes < 60 ? "#EF4444" : totalHours < 24 ? "#F59E0B" : "#9CA3AF";

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.name} numberOfLines={1}>
            {pack.name}
          </Text>
          <View style={styles.windowBadge}>
            <Text style={styles.windowText}>
              {pack.competition_window === "weekly" ? "Weekly" : "Monthly"}
            </Text>
          </View>
          {pack.competition_window === "weekly" && (
            <View style={styles.countdownChip}>
              <Text style={[styles.countdownText, { color: chipColor }]}>
                {resetInfo.label}
              </Text>
            </View>
          )}
        </View>
        <Text style={styles.meta}>
          {memberCount} member{memberCount !== 1 ? "s" : ""} ·{" "}
          {[
            pack.steps_enabled && "Steps",
            pack.workouts_enabled && "Workouts",
            pack.calories_enabled && "Calories",
            pack.water_enabled && "Water",
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>

      {topEntries.length > 0 && (
        <View style={styles.preview}>
          <Text style={styles.previewLabel}>Today's Leaders</Text>
          {topEntries.slice(0, 3).map((entry) => (
            <LeaderboardRow
              key={entry.user_id}
              entry={entry}
              isCurrentUser={entry.user_id === currentUserId}
            />
          ))}
        </View>
      )}

      {topEntries.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No scores yet today</Text>
        </View>
      )}

      <View style={styles.footer}>
        <Text style={styles.footerLink}>View Full Leaderboard →</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    marginHorizontal: 16,
    marginVertical: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    overflow: "hidden",
  },
  header: {
    padding: 16,
    gap: 4,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  name: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
    flex: 1,
  },
  windowBadge: {
    backgroundColor: "#F3F4F6",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  windowText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#6B7280",
  },
  countdownChip: {
    backgroundColor: "#1F2937",
    borderRadius: 99,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  countdownText: {
    fontSize: 11,
    fontWeight: "500",
  },
  meta: {
    fontSize: 13,
    color: "#9CA3AF",
  },
  preview: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#F3F4F6",
  },
  previewLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#9CA3AF",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  empty: {
    paddingVertical: 16,
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#F3F4F6",
  },
  emptyText: {
    fontSize: 14,
    color: "#D1D5DB",
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#F3F4F6",
    alignItems: "flex-end",
  },
  footerLink: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6366F1",
  },
});
