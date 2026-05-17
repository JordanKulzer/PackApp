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
  ActionSheetIOS,
  Platform,
  Switch,
} from "react-native";
import { setProOverride, useProOverride } from "../../../src/hooks/useIsPro";
import { ConfirmDialog } from "../../../src/components/ConfirmDialog";
import { showToast } from "../../../src/lib/toast";
import * as Application from "expo-application";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuthStore } from "../../../src/stores/authStore";
import { useAuth } from "../../../src/hooks/useAuth";
import { useHealthKit } from "../../../src/hooks/useHealthKit";
import { colors } from "../../../src/theme/colors";
import {
  AppleHealthIcon,
  OuraIcon,
  WhoopIcon,
} from "../../../src/components/IntegrationIcons";
import { supabase } from "../../../src/lib/supabase";
import { normalizeDisplayName, getInitial } from "../../../src/lib/displayName";
import type { User } from "../../../src/types/database";
import { useCurrentUser } from "../../../src/context/CurrentUserContext";
import {
  pickAvatarFromLibrary,
  takeAvatarPhoto,
  uploadAvatar,
  deleteAvatar,
} from "../../../src/lib/photoUpload";
import { EditableAvatar } from "../../../src/components/EditableAvatar";
import {
  profile as profileCopy,
  userProfile,
} from "../../../src/constants/strings";
import { StreakLine } from "../../../src/components/profile/StreakLine";
import { StatSheetRow } from "../../../src/components/profile/StatSheetRow";
import { NavRow } from "../../../src/components/profile/NavRow";

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
  warning: "#F5A623",
} as const;

interface AllTimeStats {
  totalPoints: number;
  totalDaysLogged: number;
  longestStreak: number;
  currentStreak: number;
  packsJoined: number;
  totalSteps: number;
  totalWorkouts: number;
  totalCalories: number;
  totalWaterOz: number;
}

// Pass 22 — comma-separated formatting for lifetime stat-sheet values.
// Mirrors public profile's formatter (intentional duplication; one-line
// helper, no shared util lift). Explicit en-US locale matches Pass 20e.
function formatStatNumber(n: number): string {
  return n.toLocaleString("en-US");
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
  const { applyLocal, refresh: refreshCurrentUser, user: currentUser } = useCurrentUser();
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
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const proOverride = useProOverride();

  const handleAvatarPress = () => {
    if (!user) return;
    const hasAvatar = !!profile?.avatar_url;

    const doUpload = async (picker: () => Promise<{ uri: string; width: number; height: number } | null>) => {
      const photo = await picker();
      if (!photo) return;
      setAvatarUploading(true);
      try {
        const newUrl = await uploadAvatar(user.id, photo);
        await supabase.from("users").update({ avatar_url: newUrl }).eq("id", user.id);
        applyLocal({ avatarUrl: newUrl });
        await refreshCurrentUser();
        showToast({ message: "Profile photo updated", kind: "success" });
      } catch (e) {
        showToast({ message: (e as Error).message ?? "Upload failed", kind: "error" });
      } finally {
        setAvatarUploading(false);
      }
    };

    const doRemove = async () => {
      if (!user) return;
      setAvatarUploading(true);
      try {
        await deleteAvatar(user.id);
        await supabase.from("users").update({ avatar_url: null }).eq("id", user.id);
        applyLocal({ avatarUrl: null });
        await refreshCurrentUser();
        showToast({ message: "Profile photo removed", kind: "success" });
      } catch (e) {
        showToast({ message: (e as Error).message ?? "Remove failed", kind: "error" });
      } finally {
        setAvatarUploading(false);
      }
    };

    if (Platform.OS === "ios") {
      const options = [
        "Take Photo",
        "Choose from Library",
        ...(hasAvatar ? ["Remove Photo"] : []),
        "Cancel",
      ];
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: options.length - 1, destructiveButtonIndex: hasAvatar ? 2 : undefined },
        (idx) => {
          if (idx === 0) doUpload(takeAvatarPhoto);
          else if (idx === 1) doUpload(pickAvatarFromLibrary);
          else if (hasAvatar && idx === 2) doRemove();
        },
      );
    } else {
      // Android fallback — simple Alert
      const buttons: Parameters<typeof Alert.alert>[2] = [
        { text: "Take Photo", onPress: () => doUpload(takeAvatarPhoto) },
        { text: "Choose from Library", onPress: () => doUpload(pickAvatarFromLibrary) },
        ...(hasAvatar ? [{ text: "Remove Photo", style: "destructive" as const, onPress: doRemove }] : []),
        { text: "Cancel", style: "cancel" as const },
      ];
      Alert.alert("Profile Photo", undefined, buttons);
    }
  };

  const fetchProfile = useCallback(async () => {
    if (!user) return;

    // Pass 22 — Self-profile shows true lifetime data across every pack
    // the user has ever scored in. The public profile RPC scopes its
    // totals through shared_packs (privacy boundary: viewers can only
    // see what they could have witnessed). Numbers may diverge if this
    // user has left packs that no longer overlap with a viewer's set.
    // This divergence is intentional — the self surface is a personal
    // record, the public surface is a privacy-gated relationship.
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
          "total_points, streak_days, score_date, steps_achieved, workout_achieved, calories_achieved, water_achieved, steps_count, workout_count, calories_count, water_oz_count",
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
    const totalSteps = scores.reduce((sum, s) => sum + s.steps_count, 0);
    const totalWorkouts = scores.reduce((sum, s) => sum + s.workout_count, 0);
    const totalCalories = scores.reduce((sum, s) => sum + s.calories_count, 0);
    const totalWaterOz = scores.reduce((sum, s) => sum + s.water_oz_count, 0);

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
      totalSteps,
      totalWorkouts,
      totalCalories,
      totalWaterOz,
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
    const normalized = normalizeDisplayName(newName);
    applyLocal({ displayName: normalized });
    const { error } = await supabase
      .from("users")
      .update({ display_name: normalized })
      .eq("id", user.id);
    if (error) {
      await refreshCurrentUser();
      Alert.alert("Error", "Failed to update display name.");
    } else {
      await refreshCurrentUser();
    }
  };

  const handleSignOut = () => setShowSignOutConfirm(true);

  const handleDeleteAccount = () => router.push("/(app)/profile/delete-account");

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
          <EditableAvatar
            imageUri={currentUser?.avatarUrl ?? profile?.avatar_url ?? null}
            fallbackInitial={getInitial(
              currentUser?.displayName ?? profile?.display_name ?? user?.email,
            )}
            size={80}
            uploading={avatarUploading}
            onPress={handleAvatarPress}
          />

          <TouchableOpacity
            style={styles.nameRow}
            onPress={() => setEditNameVisible(true)}
            activeOpacity={0.7}
          >
            <Text style={styles.displayName}>
              {normalizeDisplayName(currentUser?.displayName ?? profile?.display_name ?? "") || "—"}
            </Text>
            <Text style={styles.editHint}>Edit</Text>
          </TouchableOpacity>

          <Text style={styles.email}>{user?.email}</Text>

          {/* Tier line — subtle status under email rather than a floating
              pill. Profile is the wrong place to push hard for upgrade;
              the dedicated paywall surface has its own job. */}
          {isPro ? (
            <Text style={styles.tierLinePro}>Pro</Text>
          ) : (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => router.push("/paywall?trigger=profile")}
            >
              <Text style={styles.tierLineFree}>
                Free Tier <Text style={styles.tierLineUpgrade}>· Upgrade</Text>
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Streak line ──────────────────────────────────────────────────
            Pass 22: same StreakLine primitive as public profile.
            Reuses already-computed currentStreak + longestStreak from
            AllTimeStats — no new queries, no recomputation.            */}
        {stats && stats.totalDaysLogged > 0 ? (
          <StreakLine
            currentStreak={stats.currentStreak}
            bestStreak={stats.longestStreak}
          />
        ) : stats ? (
          <Text style={styles.emptyStatsHint}>{profileCopy.emptyStatsHint}</Text>
        ) : null}

        {/* ── Lifetime stat-sheet (Pass 22) ────────────────────────────────
            Self-view adds Days Logged at the top — public-profile RPC
            doesn't return that field. All four icons monochrome; color
            reserved for competitive signal elsewhere.                 */}
        {stats && stats.totalDaysLogged > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{userProfile.section.lifetime}</Text>
            <StatSheetRow
              icon={
                <Ionicons name="calendar-outline" size={18} color={C.textSecondary} />
              }
              label={userProfile.lifetime.daysLogged}
              value={formatStatNumber(stats.totalDaysLogged)}
            />
            <StatSheetRow
              icon={
                <MaterialCommunityIcons
                  name="shoe-print"
                  size={18}
                  color={C.textSecondary}
                />
              }
              label={userProfile.lifetime.steps}
              value={formatStatNumber(stats.totalSteps)}
            />
            <StatSheetRow
              icon={
                <MaterialCommunityIcons
                  name="dumbbell"
                  size={18}
                  color={C.textSecondary}
                />
              }
              label={userProfile.lifetime.workouts}
              value={formatStatNumber(stats.totalWorkouts)}
            />
            <StatSheetRow
              icon={
                <MaterialCommunityIcons
                  name="fire"
                  size={18}
                  color={C.textSecondary}
                />
              }
              label={userProfile.lifetime.calories}
              value={formatStatNumber(stats.totalCalories)}
            />
            <StatSheetRow
              icon={<Ionicons name="water" size={18} color={C.textSecondary} />}
              label={userProfile.lifetime.water}
              value={formatStatNumber(stats.totalWaterOz)}
              isLast
            />
          </View>
        )}

        {/* ── Integrations (Pass 22 — flattened to NavRow stat-sheet) ───── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Integrations</Text>
          <NavRow
            icon={<AppleHealthIcon />}
            label="Apple Health"
            subtitle={
              hkSyncing
                ? "Syncing…"
                : isAuthorized
                  ? "Connected"
                  : "Connect to sync steps & workouts"
            }
            onPress={isAuthorized ? undefined : handleHealthKit}
            disabled={hkRequesting || hkSyncing}
            trailing={
              hkRequesting || hkSyncing ? (
                <ActivityIndicator size="small" color={C.textSecondary} />
              ) : (
                <Text
                  style={[
                    styles.integrationStatus,
                    isAuthorized && styles.integrationStatusSuccess,
                  ]}
                >
                  {isAuthorized ? "✓" : "Connect"}
                </Text>
              )
            }
          />
          <NavRow
            icon={<OuraIcon />}
            label="Oura Ring"
            subtitle="Coming soon"
            trailing={<Text style={styles.integrationStatus}>Soon</Text>}
          />
          <NavRow
            icon={<WhoopIcon />}
            label="Whoop"
            subtitle="Coming soon"
            trailing={<Text style={styles.integrationStatus}>Soon</Text>}
            isLast
          />
        </View>

        {/* ── Settings (Pass 22 — NavRow) ──────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Settings</Text>
          <NavRow
            icon={
              <Ionicons
                name="notifications-outline"
                size={22}
                color={C.textSecondary}
              />
            }
            label="Notifications"
            subtitle="Manage what you hear about"
            onPress={() => router.push("/profile/notifications")}
            isLast
          />
        </View>

        {/* ── About / Legal (Pass 22 — NavRows) ────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <NavRow
            icon={
              <Ionicons
                name="shield-checkmark-outline"
                size={22}
                color={C.textSecondary}
              />
            }
            label="Privacy Policy"
            onPress={() => Linking.openURL("https://packapp.com/privacy")}
          />
          <NavRow
            icon={
              <Ionicons
                name="document-text-outline"
                size={22}
                color={C.textSecondary}
              />
            }
            label="Terms of Service"
            onPress={() => Linking.openURL("https://packapp.com/terms")}
          />
          <NavRow
            icon={
              <Ionicons
                name="help-circle-outline"
                size={22}
                color={C.textSecondary}
              />
            }
            label="Support"
            onPress={() => Linking.openURL("mailto:support@packapp.com")}
            isLast
          />
        </View>

        {/* ── Developer (TESTING ONLY — remove before public launch) ───── */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, styles.devSectionTitle]}>
            Developer
          </Text>
          <NavRow
            icon={
              <Ionicons
                name="construct-outline"
                size={22}
                color={C.warning}
              />
            }
            label="Test Pro Features"
            subtitle="TESTING ONLY — overrides Pro state for testing. Will be removed before public launch."
            onPress={() => setProOverride(!proOverride)}
            trailing={
              <Switch
                value={proOverride}
                onValueChange={setProOverride}
                trackColor={{ false: C.border, true: C.warning }}
                thumbColor="#FFFFFF"
              />
            }
            isLast
          />
        </View>

        {/* ── Account (Pass 22 → 22-polish: Sign Out + Delete Account
                              both as NavRows; the outlined-red boxed
                              Delete button has been retired) ─────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <NavRow
            icon={
              <Ionicons
                name="log-out-outline"
                size={22}
                color={C.textSecondary}
              />
            }
            label={signingOut ? "Signing out…" : "Sign Out"}
            onPress={handleSignOut}
            disabled={signingOut}
          />

          {/* Delete Account — `dangerous` flips the label to danger red.
              onPress navigates to /(app)/profile/delete-account, which is
              a dedicated destructive-flow screen owning the actual
              confirmation step + irreversible deletion. The visual
              panic-box (red-bordered CTA) is gone; the destination
              screen is the actual safeguard. */}
          <NavRow
            icon={
              <Ionicons name="trash-outline" size={22} color={C.danger} />
            }
            label="Delete Account"
            onPress={handleDeleteAccount}
            dangerous
            isLast
          />
        </View>

        {/* ── Version footer ────────────────────────────────────────────── */}
        <Text style={styles.version}>
          Pack v{appVersion} ({buildNumber})
        </Text>
      </ScrollView>

      <EditNameModal
        visible={editNameVisible}
        current={currentUser?.displayName ?? profile?.display_name ?? ""}
        onSave={handleSaveName}
        onCancel={() => setEditNameVisible(false)}
      />

      <ConfirmDialog
        visible={showSignOutConfirm}
        title="Sign out?"
        message="You'll need to sign in again to access your packs."
        confirmLabel="Sign Out"
        onConfirm={async () => {
          setSigningOut(true);
          setShowSignOutConfirm(false);
          try {
            await signOut();
            showToast({ message: "Signed out", kind: "success" });
          } catch {
            Alert.alert("Error", "Failed to sign out.");
          } finally {
            setSigningOut(false);
          }
        }}
        onCancel={() => setShowSignOutConfirm(false)}
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
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  displayName: { fontSize: 22, fontWeight: "700", color: C.textPrimary },
  editHint: { fontSize: 13, color: C.accent, fontWeight: "600" },
  email: { fontSize: 14, color: C.textSecondary },
  // Tier line — subtle status text under email. Replaces the floating
  // pill so the profile doesn't push hard for upgrade.
  tierLineFree: {
    fontSize: 12,
    color: C.textTertiary,
    marginTop: 4,
  },
  tierLinePro: {
    fontSize: 12,
    fontWeight: "600",
    color: "#D4AF37",
    marginTop: 4,
    letterSpacing: 0.5,
  },
  tierLineUpgrade: { color: C.accent, fontWeight: "600" },

  // Empty-state hint — replaces the lifetime stat-sheet when the user
  // hasn't logged any activity yet. Single line, packmate voice.
  emptyStatsHint: {
    fontSize: 14,
    color: C.textTertiary,
    textAlign: "center",
    paddingHorizontal: 24,
    paddingVertical: 16,
    fontStyle: "italic",
  },

  // Sections (Pass 22 — flat stat-sheet, no boxed groups)
  section: { gap: 8 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: C.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginLeft: 4,
  },
  devSectionTitle: { color: C.warning },

  // Integration trailing status text (used inside NavRow's `trailing` slot
  // for "Connect" / "✓" / "Soon"). The connected `✓` flips to success green;
  // the rest stay accent for affordance / secondary for "coming soon".
  integrationStatus: { fontSize: 14, color: C.accent, fontWeight: "600" },
  integrationStatusSuccess: { color: C.success },

  version: {
    fontSize: 12,
    color: C.textTertiary,
    textAlign: "center",
    marginTop: 8,
  },
});
