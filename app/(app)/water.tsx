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
import { BrandColors } from "../../src/constants/brand";

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
        <ActivityIndicator size="large" color={BrandColors.blue} />
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
    backgroundColor: BrandColors.background,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BrandColors.background,
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
    color: BrandColors.ink,
    letterSpacing: -0.5,
  },
  date: {
    fontSize: 14,
    color: BrandColors.inkMuted,
  },
  card: {
    backgroundColor: BrandColors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#30363D",
  },
  historySection: {
    gap: 8,
  },
  historyTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: BrandColors.inkMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  emptyHistory: {
    backgroundColor: BrandColors.surface,
    borderRadius: 12,
    padding: 20,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#30363D",
  },
  emptyText: {
    color: BrandColors.inkDim,
    fontSize: 15,
  },
  historyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: BrandColors.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#30363D",
  },
  historyAmount: {
    fontSize: 15,
    fontWeight: "600",
    color: BrandColors.ink,
  },
  historyTime: {
    fontSize: 13,
    color: BrandColors.inkMuted,
  },
  // Info box uses a faint blue tint over the dark surface — semantic
  // emphasis without the bright #EFF6FF light-theme look.
  infoBox: {
    backgroundColor: "rgba(59, 130, 246, 0.08)",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.20)",
  },
  infoText: {
    fontSize: 14,
    color: BrandColors.blueSoft,
    lineHeight: 20,
  },
  infoPoints: {
    fontWeight: "700",
  },
});
