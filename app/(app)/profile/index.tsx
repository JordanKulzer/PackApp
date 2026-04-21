import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Modal,
  TextInput,
  Linking,
} from "react-native";
import * as Application from "expo-application";
import { useRouter } from "expo-router";
import { useAuthStore } from "../../../src/stores/authStore";
import { useAuth } from "../../../src/hooks/useAuth";
import { useHealthKit } from "../../../src/hooks/useHealthKit";
import { colors } from "../../../src/theme/colors";
import { PointsBadge } from "../../../src/components/PointsBadge";
import { supabase } from "../../../src/lib/supabase";
import type { User } from "../../../src/types/database";

const C = {
  bg: "#0B0F14",
  surface: "#121821",
  surfaceRaised: "#1C2333",
  border: "#30363D",
  textPrimary: "#E6EDF3",
  textSecondary: "#8B949E",
  textTertiary: "#484F58",
  accent: colors.self,
  success: "#3FB950",
  danger: "#F85149",
} as const;

interface AllTimeStats {
  totalPoints: number;
  totalDaysLogged: number;
  longestStreak: number;
  currentStreak: number;
  packsJoined: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit display name modal
// ─────────────────────────────────────────────────────────────────────────────

function EditNameModal({
  visible,
  current,
  onSave,
  onCancel,
}: {
  visible: boolean;
  current: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(current);

  useEffect(() => {
    if (visible) setValue(current);
  }, [visible, current]);

  const canSave = value.trim().length > 0 && value.trim() !== current;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={modal.overlay}>
        <View style={modal.sheet}>
          <Text style={modal.title}>Edit Display Name</Text>
          <TextInput
            style={modal.input}
            value={value}
            onChangeText={(t) => setValue(t.slice(0, 30))}
            placeholder="Your name"
            placeholderTextColor={C.textTertiary}
            autoFocus
            maxLength={30}
            returnKeyType="done"
            onSubmitEditing={() => canSave && onSave(value.trim())}
          />
          <Text style={modal.charCount}>{value.length}/30</Text>
          <View style={modal.buttons}>
            <TouchableOpacity
              style={modal.cancelBtn}
              onPress={onCancel}
              activeOpacity={0.7}
            >
              <Text style={modal.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[modal.saveBtn, !canSave && modal.saveBtnDisabled]}
              onPress={() => canSave && onSave(value.trim())}
              disabled={!canSave}
              activeOpacity={0.8}
            >
              <Text style={modal.saveText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const modal = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  sheet: {
    backgroundColor: C.surfaceRaised,
    borderRadius: 20,
    padding: 24,
    width: "100%",
    gap: 12,
    borderWidth: 0.5,
    borderColor: C.border,
  },
  title: { fontSize: 17, fontWeight: "700", color: C.textPrimary },
  input: {
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: C.textPrimary,
    borderWidth: 0.5,
    borderColor: C.border,
  },
  charCount: { fontSize: 12, color: C.textTertiary, textAlign: "right" },
  buttons: { flexDirection: "row", gap: 10, marginTop: 4 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: C.surface,
    alignItems: "center",
    borderWidth: 0.5,
    borderColor: C.border,
  },
  cancelText: { fontSize: 15, fontWeight: "600", color: C.textSecondary },
  saveBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: C.accent,
    alignItems: "center",
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveText: { fontSize: 15, fontWeight: "700", color: "#FFF" },
});

// ─────────────────────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────────────────────

export default function Profile() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { signOut } = useAuth();
  const {
    isAuthorized,
    isSyncing: hkSyncing,
    requestPermissions,
  } = useHealthKit(user?.id ?? null);
  const [hkRequesting, setHkRequesting] = useState(false);
  const [profile, setProfile] = useState<User | null>(null);
  const [stats, setStats] = useState<AllTimeStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [editNameVisible, setEditNameVisible] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  const fetchProfile = useCallback(async () => {
    if (!user) return;

    const [profileResult, packsResult, scoresResult] = await Promise.all([
      supabase.from("users").select("*").eq("id", user.id).single(),
      supabase
        .from("pack_members")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("is_active", true),
      supabase
        .from("daily_scores")
        .select(
          "total_points, streak_days, score_date, steps_achieved, workout_achieved, calories_achieved, water_achieved",
        )
        .eq("user_id", user.id)
        .order("score_date", { ascending: true }),
    ]);

    setProfile(profileResult.data ?? null);

    const scores = scoresResult.data ?? [];
    const totalPoints = scores.reduce((sum, s) => sum + s.total_points, 0);
    const longestStreak = scores.reduce(
      (max, s) => Math.max(max, s.streak_days),
      0,
    );

    let currentStreak = 0;
    if (scores.length > 0) {
      const latest = scores[scores.length - 1];
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const yesterday = new Date(Date.now() - 86400000)
        .toISOString()
        .split("T")[0];
      const isRecent =
        latest.score_date === today || latest.score_date === yesterday;
      const anyAchieved =
        latest.steps_achieved ||
        latest.workout_achieved ||
        latest.calories_achieved ||
        latest.water_achieved;
      if (isRecent && anyAchieved) currentStreak = latest.streak_days;
    }

    setStats({
      totalPoints,
      totalDaysLogged: scores.length,
      longestStreak,
      currentStreak,
      packsJoined: packsResult.count ?? 0,
    });

    setIsLoading(false);
  }, [user]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchProfile();
    setIsRefreshing(false);
  };

  const handleSaveName = async (newName: string) => {
    setEditNameVisible(false);
    if (!user) return;
    const { error } = await supabase
      .from("users")
      .update({ display_name: newName })
      .eq("id", user.id);
    if (error) {
      Alert.alert("Error", "Failed to update display name.");
    } else {
      setProfile((prev) => (prev ? { ...prev, display_name: newName } : prev));
    }
  };

  const handleSignOut = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          setSigningOut(true);
          try {
            await signOut();
          } catch {
            Alert.alert("Error", "Failed to sign out.");
          } finally {
            setSigningOut(false);
          }
        },
      },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "Delete Account",
      "This will permanently delete your account and all data. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeletingAccount(true);
            try {
              // TODO: implement delete_user_account RPC in Supabase
              Alert.alert(
                "Not available",
                "Account deletion is coming soon. Please contact support@packapp.com to delete your account.",
              );
            } finally {
              setDeletingAccount(false);
            }
          },
        },
      ],
    );
  };

  const handleHealthKit = async () => {
    if (isAuthorized || hkRequesting) return;
    setHkRequesting(true);
    try {
      const granted = await requestPermissions();
      if (!granted) {
        Alert.alert(
          "HealthKit Access",
          "Please enable HealthKit access in Settings > Privacy & Security > Health > Pack.",
        );
      }
    } finally {
      setHkRequesting(false);
    }
  };

  const isPro = profile?.subscription_tier === "pro";
  const appVersion = Application.nativeApplicationVersion ?? "1.0.0";
  const buildNumber = Application.nativeBuildVersion ?? "1";

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={C.accent} />
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={C.textTertiary}
          />
        }
      >
        <View style={styles.header}>
          <Text style={styles.title}>Profile</Text>
        </View>

        {/* ── Avatar + identity ─────────────────────────────────────────── */}
        <View style={styles.avatarSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarInitials}>
              {(profile?.display_name ?? user?.email ?? "?")
                .charAt(0)
                .toUpperCase()}
            </Text>
          </View>

          <TouchableOpacity
            style={styles.nameRow}
            onPress={() => setEditNameVisible(true)}
            activeOpacity={0.7}
          >
            <Text style={styles.displayName}>
              {profile?.display_name ?? "—"}
            </Text>
            <Text style={styles.editHint}>Edit</Text>
          </TouchableOpacity>

          <Text style={styles.email}>{user?.email}</Text>

          {/* Subscription pill */}
          {isPro ? (
            <View style={[styles.tierBadge, styles.tierBadgePro]}>
              <Text style={[styles.tierText, styles.tierTextPro]}>Pro</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.tierBadge}
              activeOpacity={0.7}
              onPress={() => router.push("/(app)/paywall?trigger=profile")}
            >
              <Text style={styles.tierText}>
                Free Tier <Text style={styles.upgradeText}>· Upgrade</Text>
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Stats ─────────────────────────────────────────────────────── */}
        {stats && (
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <PointsBadge points={stats.totalPoints} size="lg" highlight />
              <Text style={styles.statLabel}>All-time Points</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{stats.currentStreak}</Text>
              <Text style={styles.statLabel}>Current Streak</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{stats.longestStreak}</Text>
              <Text style={styles.statLabel}>Best Streak</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{stats.totalDaysLogged}</Text>
              <Text style={styles.statLabel}>Days Logged</Text>
            </View>
          </View>
        )}

        {/* ── Integrations ─────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Integrations</Text>
          <View style={styles.group}>
            <TouchableOpacity
              style={styles.row}
              onPress={handleHealthKit}
              activeOpacity={isAuthorized ? 1 : 0.7}
              disabled={hkRequesting || hkSyncing}
            >
              <Text style={styles.rowIcon}>🍎</Text>
              <View style={styles.rowInfo}>
                <Text style={styles.rowLabel}>Apple Health</Text>
                <Text style={styles.rowDesc}>
                  {hkSyncing
                    ? "Syncing…"
                    : isAuthorized
                      ? "Connected"
                      : "Connect to sync steps & workouts"}
                </Text>
              </View>
              {hkRequesting || hkSyncing ? (
                <ActivityIndicator size="small" color={C.textSecondary} />
              ) : (
                <Text
                  style={[
                    styles.rowValue,
                    isAuthorized && styles.rowValueSuccess,
                  ]}
                >
                  {isAuthorized ? "✓" : "Connect"}
                </Text>
              )}
            </TouchableOpacity>
            <View style={styles.rowDivider} />
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.7}
              onPress={() =>
                isPro
                  ? undefined
                  : router.push("/(app)/paywall?trigger=oura_integration")
              }
            >
              <Text style={styles.rowIcon}>💍</Text>
              <View style={styles.rowInfo}>
                <Text style={styles.rowLabel}>Oura Ring</Text>
                <Text style={styles.rowDesc}>
                  {isPro ? "Coming soon" : "Pro feature"}
                </Text>
              </View>
              {isPro ? (
                <Text style={styles.rowValue}>Soon</Text>
              ) : (
                <Text style={styles.rowValueLocked}>🔒</Text>
              )}
            </TouchableOpacity>
            <View style={styles.rowDivider} />
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.7}
              onPress={() =>
                isPro
                  ? undefined
                  : router.push("/(app)/paywall?trigger=whoop_integration")
              }
            >
              <Text style={styles.rowIcon}>⌚</Text>
              <View style={styles.rowInfo}>
                <Text style={styles.rowLabel}>Whoop</Text>
                <Text style={styles.rowDesc}>
                  {isPro ? "Coming soon" : "Pro feature"}
                </Text>
              </View>
              {isPro ? (
                <Text style={styles.rowValue}>Soon</Text>
              ) : (
                <Text style={styles.rowValueLocked}>🔒</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Settings ─────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Settings</Text>
          <View style={styles.group}>
            <TouchableOpacity
              style={styles.row}
              onPress={() => router.push("/profile/notifications")}
              activeOpacity={0.7}
            >
              <Text style={styles.rowIcon}>🔔</Text>
              <View style={styles.rowInfo}>
                <Text style={styles.rowLabel}>Notifications</Text>
                <Text style={styles.rowDesc}>Manage what you hear about</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── About / Legal ────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <View style={styles.group}>
            <TouchableOpacity
              style={styles.row}
              onPress={() => Linking.openURL("https://packapp.com/privacy")}
              activeOpacity={0.7}
            >
              <Text style={styles.rowLabel}>Privacy Policy</Text>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
            <View style={styles.rowDivider} />
            <TouchableOpacity
              style={styles.row}
              onPress={() => Linking.openURL("https://packapp.com/terms")}
              activeOpacity={0.7}
            >
              <Text style={styles.rowLabel}>Terms of Service</Text>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
            <View style={styles.rowDivider} />
            <TouchableOpacity
              style={styles.row}
              onPress={() => Linking.openURL("mailto:support@packapp.com")}
              activeOpacity={0.7}
            >
              <Text style={styles.rowLabel}>Support</Text>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Account ──────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.group}>
            <TouchableOpacity
              style={styles.row}
              onPress={handleSignOut}
              disabled={signingOut}
              activeOpacity={0.7}
            >
              <Text style={[styles.rowLabel, styles.dangerText]}>
                {signingOut ? "Signing out…" : "Sign Out"}
              </Text>
            </TouchableOpacity>
            <View style={styles.rowDivider} />
            <TouchableOpacity
              style={styles.row}
              onPress={handleDeleteAccount}
              disabled={deletingAccount}
              activeOpacity={0.7}
            >
              <Text style={[styles.rowLabel, styles.dangerText]}>
                {deletingAccount ? "Deleting…" : "Delete Account"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Version footer ────────────────────────────────────────────── */}
        <Text style={styles.version}>
          Pack v{appVersion} ({buildNumber})
        </Text>
      </ScrollView>

      <EditNameModal
        visible={editNameVisible}
        current={profile?.display_name ?? ""}
        onSave={handleSaveName}
        onCancel={() => setEditNameVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.bg,
  },
  content: { padding: 16, paddingTop: 60, paddingBottom: 40, gap: 24 },
  header: {},
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: C.textPrimary,
    letterSpacing: -0.5,
  },

  // Avatar
  avatarSection: { alignItems: "center", gap: 6, paddingVertical: 8 },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: C.surfaceRaised,
    borderWidth: 0.5,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  avatarInitials: { fontSize: 32, fontWeight: "700", color: C.textPrimary },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  displayName: { fontSize: 22, fontWeight: "700", color: C.textPrimary },
  editHint: { fontSize: 13, color: C.accent, fontWeight: "600" },
  email: { fontSize: 14, color: C.textSecondary },
  tierBadge: {
    backgroundColor: C.surfaceRaised,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginTop: 4,
    borderWidth: 0.5,
    borderColor: C.border,
  },
  tierBadgePro: { borderColor: "#D4AF37" },
  tierText: { fontSize: 13, fontWeight: "600", color: C.textSecondary },
  tierTextPro: { color: "#D4AF37" },
  upgradeText: { color: C.accent },

  // Stats
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  statCard: {
    flex: 1,
    minWidth: "45%",
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    gap: 8,
    borderWidth: 0.5,
    borderColor: C.border,
  },
  statValue: { fontSize: 24, fontWeight: "700", color: C.textPrimary },
  statLabel: { fontSize: 12, color: C.textSecondary, fontWeight: "500" },

  // Sections
  section: { gap: 8 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: C.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
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
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.border,
    marginLeft: 16,
  },
  rowIcon: { fontSize: 20 },
  rowInfo: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: "600", color: C.textPrimary },
  rowDesc: { fontSize: 13, color: C.textSecondary, marginTop: 1 },
  rowValue: { fontSize: 14, color: C.accent, fontWeight: "600" },
  rowValueSuccess: { color: C.success },
  rowValueLocked: { fontSize: 16 },
  chevron: { fontSize: 20, color: C.textTertiary, fontWeight: "300" },
  dangerText: { color: C.danger },
  version: {
    fontSize: 12,
    color: C.textTertiary,
    textAlign: "center",
    marginTop: 8,
  },
});
