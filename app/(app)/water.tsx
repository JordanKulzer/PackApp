import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useAuthStore } from "../../src/stores/authStore";
import { useHealthKit } from "../../src/hooks/useHealthKit";
import { WaterLogger } from "../../src/components/WaterLogger";
import { supabase } from "../../src/lib/supabase";

const DEFAULT_WATER_TARGET = 64;

export default function WaterScreen() {
  const user = useAuthStore((s) => s.user);
  const { logWater } = useHealthKit(user?.id ?? null);
  const [totalOz, setTotalOz] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [logs, setLogs] = useState<{ amount_oz: number; logged_at: string }[]>(
    [],
  );

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const fetchTodayLogs = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("water_logs")
      .select("amount_oz, logged_at")
      .eq("user_id", user.id)
      .eq("log_date", today)
      .order("logged_at", { ascending: false });

    const entries = data ?? [];
    setLogs(entries);
    setTotalOz(entries.reduce((sum, l) => sum + l.amount_oz, 0));
    setIsFetching(false);
  }, [user, today]);

  useEffect(() => {
    fetchTodayLogs();
  }, [fetchTodayLogs]);

  const handleLog = async (amountOz: number) => {
    if (!user) return;
    setIsLoading(true);
    try {
      await logWater(amountOz);
      await fetchTodayLogs();
    } catch {
      Alert.alert("Error", "Failed to log water. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchTodayLogs();
    setIsRefreshing(false);
  };

  const formatTime = (isoString: string) => {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  if (isFetching) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#6366F1" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
      }
    >
      <View style={styles.header}>
        <Text style={styles.title}>Water Log</Text>
        <Text style={styles.date}>
          {new Date().toLocaleDateString([], {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </Text>
      </View>

      <View style={styles.card}>
        <WaterLogger
          totalOzToday={totalOz}
          targetOz={DEFAULT_WATER_TARGET}
          onLog={handleLog}
          isLoading={isLoading}
        />
      </View>

      <View style={styles.historySection}>
        <Text style={styles.historyTitle}>Today's Entries</Text>
        {logs.length === 0 ? (
          <View style={styles.emptyHistory}>
            <Text style={styles.emptyText}>No water logged yet</Text>
          </View>
        ) : (
          logs.map((log, i) => (
            <View key={i} style={styles.historyRow}>
              <Text style={styles.historyAmount}>💧 +{log.amount_oz} oz</Text>
              <Text style={styles.historyTime}>
                {formatTime(log.logged_at)}
              </Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.infoBox}>
        <Text style={styles.infoText}>
          Reach {DEFAULT_WATER_TARGET} oz to earn{" "}
          <Text style={styles.infoPoints}>+8 pts</Text> toward your Pack score
          today!
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F9FAFB",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    padding: 16,
    gap: 20,
    paddingTop: 60,
  },
  header: {
    gap: 2,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#111827",
    letterSpacing: -0.5,
  },
  date: {
    fontSize: 14,
    color: "#9CA3AF",
  },
  card: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  historySection: {
    gap: 8,
  },
  historyTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#6B7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  emptyHistory: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 20,
    alignItems: "center",
  },
  emptyText: {
    color: "#D1D5DB",
    fontSize: 15,
  },
  historyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#FFF",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E5E7EB",
  },
  historyAmount: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
  },
  historyTime: {
    fontSize: 13,
    color: "#9CA3AF",
  },
  infoBox: {
    backgroundColor: "#EFF6FF",
    borderRadius: 12,
    padding: 14,
  },
  infoText: {
    fontSize: 14,
    color: "#3B82F6",
    lineHeight: 20,
  },
  infoPoints: {
    fontWeight: "700",
  },
});
