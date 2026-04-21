import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../../../src/stores/authStore";
import { supabase } from "../../../src/lib/supabase";
import { colors } from "../../../src/theme/colors";

const C = {
  bg: "#0B0F14",
  surface: "#121821",
  surfaceRaised: "#1C2333",
  border: "#30363D",
  textPrimary: "#E6EDF3",
  textSecondary: "#8B949E",
  textTertiary: "#484F58",
  accent: colors.self,
} as const;

interface PrefRow {
  key: string;
  label: string;
  desc: string;
}

const PREFS: PrefRow[] = [
  {
    key: "goal_completed",
    label: "Goal Completed",
    desc: "When a pack member hits a goal",
  },
  {
    key: "overtaken",
    label: "Overtaken",
    desc: "When someone passes you in the standings",
  },
  {
    key: "new_member",
    label: "New Member",
    desc: "When someone joins your pack",
  },
  {
    key: "streak_reminder",
    label: "Streak Reminder",
    desc: "Daily reminder if you haven't logged today",
    // TODO: add time picker (hour/minute) for this reminder
  },
  {
    key: "daily_summary",
    label: "Daily Summary",
    desc: "Points summary each evening",
    // TODO: add time picker for delivery time (default 8pm local)
  },
];

export default function NotificationsScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);

  const loadPrefs = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("user_notification_prefs")
      .select("pref_key, enabled")
      .eq("user_id", user.id);

    const loaded: Record<string, boolean> = {};
    (data ?? []).forEach((row: { pref_key: string; enabled: boolean }) => {
      loaded[row.pref_key] = row.enabled;
    });
    // Default to true for any key not explicitly stored
    PREFS.forEach((p) => {
      if (!(p.key in loaded)) loaded[p.key] = true;
    });
    setPrefs(loaded);
    setIsLoading(false);
  }, [user]);

  useEffect(() => {
    loadPrefs();
  }, [loadPrefs]);

  const handleToggle = async (key: string, value: boolean) => {
    if (!user) return;
    setPrefs((prev) => ({ ...prev, [key]: value }));
    await supabase.from("user_notification_prefs").upsert(
      { user_id: user.id, pref_key: key, enabled: value },
      { onConflict: "user_id,pref_key" },
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={22} color={C.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Notifications</Text>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={C.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.sectionTitle}>Activity</Text>
          <View style={styles.group}>
            {PREFS.map((pref, i) => (
              <View
                key={pref.key}
                style={[styles.row, i < PREFS.length - 1 && styles.rowBorder]}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>{pref.label}</Text>
                  <Text style={styles.rowDesc}>{pref.desc}</Text>
                </View>
                <Switch
                  value={prefs[pref.key] ?? true}
                  onValueChange={(v) => handleToggle(pref.key, v)}
                  trackColor={{ false: C.surfaceRaised, true: C.accent }}
                  thumbColor="#FFFFFF"
                />
              </View>
            ))}
          </View>

          <Text style={styles.footer}>
            You'll only receive notifications for events in packs you belong to.
            We never send marketing messages.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 60,
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 8,
  },
  backBtn: { padding: 4 },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: C.textPrimary,
    letterSpacing: -0.3,
  },
  content: { padding: 16, gap: 8 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: C.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 4,
    marginLeft: 4,
  },
  group: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: C.border,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: "600", color: C.textPrimary },
  rowDesc: { fontSize: 13, color: C.textSecondary, marginTop: 1 },
  footer: {
    fontSize: 12,
    color: C.textTertiary,
    textAlign: "center",
    lineHeight: 18,
    marginTop: 12,
    paddingHorizontal: 8,
  },
});
