import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";
import { useNavigation, CommonActions } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../../../src/stores/authStore";
import { supabase } from "../../../src/lib/supabase";
import { useIsPro } from "../../../src/hooks/useIsPro";
import { analytics } from "../../../src/lib/analytics";
import { colors } from "../../../src/theme/colors";
import { getDeviceTimezone } from "../../../src/lib/packDates";
import { onboarding } from "../../../src/constants/strings";
import { ActivityToggleRow } from "../../../src/components/profile/ActivityToggleRow";
import { ScoringInfoSheet } from "../../../src/components/ScoringInfoSheet";

const C = {
  bg: "#0B0F14",
  surface: "#121821",
  border: "#30363D",
  textPrimary: "#E6EDF3",
  textSecondary: "#8B949E",
  textTertiary: "#484F58",
  accent: colors.accent,
} as const;

function generateInviteCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export default function CreatePack() {
  const router = useRouter();
  const navigation = useNavigation();
  const user = useAuthStore((s) => s.user);
  const { isPro, effectivePackLimit } = useIsPro();

  const [name, setName] = useState("");
  const [window, setWindow] = useState<"weekly" | "monthly">("weekly");
  const [stepsEnabled, setStepsEnabled] = useState(true);
  const [workoutsEnabled, setWorkoutsEnabled] = useState(true);
  const [caloriesEnabled, setCaloriesEnabled] = useState(true);
  const [waterEnabled, setWaterEnabled] = useState(true);
  const [stepTarget, setStepTarget] = useState("10000");
  const [calorieTarget, setCalorieTarget] = useState("500");
  const [waterTarget, setWaterTarget] = useState("64");
  const [isLoading, setIsLoading] = useState(false);
  const [showScoringInfo, setShowScoringInfo] = useState(false);

  const openPaywall = (trigger: string) => {
    analytics.gateHit(trigger);
    router.push(`/paywall?trigger=${trigger}`);
  };

  const handleWindowPress = (opt: "weekly" | "monthly") => {
    if (opt === "monthly" && !isPro) {
      openPaywall("monthly_window");
      return;
    }
    setWindow(opt);
  };

  // Pack tab is `href: null`; from inside it router.back() leaves the
  // tab's nested state intact (Pass 24-followup-3 diagnosis). Apply the
  // same fresh-key reset on Cancel as Pack Detail's Back / leave / delete
  // handlers — see app/(app)/pack/[id].tsx for the full rationale.
  const handleCancel = () => {
    const parent = navigation.getParent();
    if (!parent) {
      router.replace("/(app)/home");
      return;
    }
    const pre = parent.getState();
    const homeIndex = pre.routes.findIndex((r) => r.name === "home");
    parent.dispatch(
      CommonActions.reset({
        ...pre,
        index: homeIndex >= 0 ? homeIndex : 0,
        routes: pre.routes.map((r) =>
          r.name === "pack"
            ? {
                name: "pack",
                key: `pack-${Math.random().toString(36).slice(2)}`,
              }
            : r,
        ),
      }),
    );
  };

  const handleCreate = async () => {
    if (!user) return;
    if (!name.trim()) {
      Alert.alert("Name required", "Please give your pack a name.");
      return;
    }

    setIsLoading(true);
    try {
      // Check free tier pack limit
      const { count } = await supabase
        .from("pack_members")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("is_active", true);

      const limit = effectivePackLimit;
      if (!isPro && (count ?? 0) >= limit) {
        analytics.gateHit("pack_limit");
        router.push("/paywall?trigger=pack_limit");
        setIsLoading(false);
        return;
      }

      const packTz = getDeviceTimezone();

      // Single atomic RPC: creates pack + pack_member + run in one transaction.
      // Uses SECURITY DEFINER so RLS on runs doesn't block the insert.
      // Run window dates are computed server-side from pack_timezone — weekly
      // = Mon→Sun (matches rollover_expired_runs), monthly = first→last of
      // month. See supabase/migrations/20260504_fix_create_pack_with_run_week_convention.sql.
      const { data, error } = await supabase.rpc("create_pack_with_run", {
        pack_name: name.trim(),
        pack_invite_code: generateInviteCode(),
        pack_window: window,
        pack_timezone: packTz,
        pack_steps_enabled: stepsEnabled,
        pack_workouts_enabled: workoutsEnabled,
        pack_calories_enabled: caloriesEnabled,
        pack_water_enabled: waterEnabled,
        pack_step_target: parseInt(stepTarget, 10) || 10000,
        pack_calorie_target: parseInt(calorieTarget, 10) || 500,
        pack_water_target_oz: parseInt(waterTarget, 10) || 64,
      });

      if (error) throw error;

      const packId = (data as { pack_id: string }).pack_id;

      // Pack 9 funnel — pack_created. is_first_pack derived from the count
      // query above (count was the user's pack count BEFORE this insert).
      // current_pack_count is count + 1 (the just-created pack).
      const goalCount =
        (stepsEnabled ? 1 : 0) +
        (workoutsEnabled ? 1 : 0) +
        (caloriesEnabled ? 1 : 0) +
        (waterEnabled ? 1 : 0);
      analytics.packCreated({
        is_first_pack: (count ?? 0) === 0,
        goal_count: goalCount,
        member_limit_chosen: isPro ? 25 : 10,
        cadence: window === "monthly" ? "monthly" : "weekly",
        current_pack_count: (count ?? 0) + 1,
      });

      // Replace create screen so Back from pack detail returns to Home, not here.
      router.replace(`/(app)/pack/${packId}`);
    } catch (error) {
      console.error("[PACK CREATE ERROR]", JSON.stringify(error, null, 2));
      Alert.alert("Failed to create pack", JSON.stringify(error));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* 3-column header. Chevron + "Back" text invoke the Cancel handler;
          "Create" stays right-aligned. Notifications-style chrome
          (paddingTop: 60, title weight 700) within the 3-column structure. */}
      <View style={styles.header}>
        <Pressable
          onPress={handleCancel}
          style={styles.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 16, right: 12 }}
        >
          <Ionicons name="chevron-back" size={22} color={C.textPrimary} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>New Pack</Text>
        <TouchableOpacity
          onPress={handleCreate}
          disabled={isLoading}
          style={styles.saveBtn}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={C.accent} />
          ) : (
            <Text style={styles.saveBtnText}>Create</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* Pass 28: single formStack for the whole form. All seven rows
            (Pack Name, Competition Window, four activities, scoring teaser)
            are direct children with uniform gap: 16 between them. In-row
            stacking (label + subtitle + content) handled by fieldGroup
            wrappers for the field rows; ActivityToggleRow handles its own
            internal layout per the locked component contract. */}
        <View style={styles.formStack}>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Pack Name</Text>
            {/* TODO(voice review): subtitle copy provisional. */}
            <Text style={styles.fieldSubtitle}>
              Visible to everyone in the pack
            </Text>
            <TextInput
              style={styles.nameInput}
              placeholder={onboarding.firstPack.namePlaceholder}
              placeholderTextColor={C.textTertiary}
              value={name}
              onChangeText={setName}
              maxLength={40}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Competition Window</Text>
            {/* TODO(voice review): subtitle copy provisional. */}
            <Text style={styles.fieldSubtitle}>
              How often the leaderboard resets
            </Text>
            <View style={styles.segmented}>
              {(["weekly", "monthly"] as const).map((opt) => {
                const locked = opt === "monthly" && !isPro;
                const active = window === opt;
                return (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.segment, active && styles.segmentActive]}
                    onPress={() => handleWindowPress(opt)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.segmentInner}>
                      <Text
                        style={[
                          styles.segmentText,
                          active && styles.segmentTextActive,
                        ]}
                      >
                        {opt === "weekly" ? "Weekly" : "Monthly"}
                      </Text>
                      {locked && (
                        <Ionicons
                          name="lock-closed"
                          size={12}
                          color={C.textTertiary}
                          style={{ marginLeft: 4 }}
                        />
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
            {window === "monthly" && (
              <Text style={styles.windowHint}>
                Resets on the 1st of each month
              </Text>
            )}
          </View>

          <ActivityToggleRow
            label="Steps"
            description={`Target: ${stepTarget} steps`}
            value={stepsEnabled}
            onValueChange={setStepsEnabled}
            expanded={
              <TextInput
                style={styles.inlineInput}
                placeholder="Step target"
                placeholderTextColor={C.textTertiary}
                keyboardType="number-pad"
                value={stepTarget}
                onChangeText={setStepTarget}
              />
            }
          />

          <ActivityToggleRow
            label="Workouts"
            description="Any workout logged"
            value={workoutsEnabled}
            onValueChange={setWorkoutsEnabled}
          />

          <ActivityToggleRow
            label="Active Calories"
            description={`Target: ${calorieTarget} cal`}
            value={caloriesEnabled}
            onValueChange={setCaloriesEnabled}
            expanded={
              <TextInput
                style={styles.inlineInput}
                placeholder="Calorie target"
                placeholderTextColor={C.textTertiary}
                keyboardType="number-pad"
                value={calorieTarget}
                onChangeText={setCalorieTarget}
              />
            }
          />

          <ActivityToggleRow
            label="Water"
            description={`Target: ${waterTarget} oz`}
            value={waterEnabled}
            onValueChange={setWaterEnabled}
            isLast
            expanded={
              <TextInput
                style={styles.inlineInput}
                placeholder="Water target (oz)"
                placeholderTextColor={C.textTertiary}
                keyboardType="number-pad"
                value={waterTarget}
                onChangeText={setWaterTarget}
              />
            }
          />

          {/* TODO(voice review): teaser line, provisional copy. */}
          <Pressable
            onPress={() => setShowScoringInfo(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.scoringRow}
          >
            <Text style={styles.scoringText}>
              Streaks multiply your points — keep showing up.
            </Text>
            <Ionicons
              name="information-circle-outline"
              size={16}
              color={C.textTertiary}
            />
          </Pressable>
        </View>
      </ScrollView>

      <ScoringInfoSheet
        visible={showScoringInfo}
        onClose={() => setShowScoringInfo(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: C.bg },

  // Header — 3-column. chevron+text on left, title centered, Create on right.
  // Paddings/font sizing borrowed from Notifications header for chrome
  // consistency across the profile-family of pushed pages.
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
    backgroundColor: C.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minWidth: 80,
  },
  backText: {
    fontSize: 16,
    color: C.textPrimary,
    fontWeight: "400",
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
    color: C.textPrimary,
    textAlign: "center",
    letterSpacing: -0.3,
  },
  saveBtn: { minWidth: 80, alignItems: "flex-end" },
  saveBtnText: { fontSize: 16, fontWeight: "700", color: C.accent },

  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },

  // Pass 28: single parent stack for all rows on the form. Uniform gap: 16
  // produces consistent row-boundary rhythm across Pack Name, Competition
  // Window, the four activity toggle rows, and the scoring teaser.
  // ActivityToggleRow keeps its internal paddingVertical (Pass 26 component
  // contract); per-row content edges sit slightly further apart on activity
  // rows than on field rows as a result, but the row-boundary rhythm is
  // uniform.
  formStack: { gap: 16 },

  // Field-level label sitting above an input. Brightness matches
  // ActivityToggleRow's label so the field labels and the activity row
  // labels read at the same hierarchy level.
  fieldLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: C.textPrimary,
    marginLeft: 4,
  },
  // Pass 28: secondary subtitle sitting under the field label. Matches
  // ActivityToggleRow's `description` style exactly so field rows and
  // activity rows read at the same brightness level for their helper copy.
  fieldSubtitle: {
    fontSize: 13,
    color: C.textSecondary,
    marginTop: 2,
    marginLeft: 4,
  },
  // Wrapper around a single field-label + subtitle + content stack. Tight
  // gap groups the trio visually as one row; the surrounding formStack's
  // gap separates one fieldGroup from the next.
  fieldGroup: {
    gap: 6,
  },

  // Pack Name — Pass 26-followup-2 subtle-box treatment. Full-perimeter
  // hairline + transparent background restores "this is editable"
  // affordance without the heavy boxed treatment from pre-Pass-26.
  // Matches the segmented control's outlined-container aesthetic family.
  // Pass 28: marginBottom property dropped — formStack.gap: 16 now
  // handles between-row spacing uniformly.
  nameInput: {
    fontSize: 16,
    color: C.textPrimary,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    borderRadius: 8,
    backgroundColor: "transparent",
  },

  // Competition Window — segmented control preserved (recognizable iOS
  // pattern for binary choice). Heavy boxed wrapper dropped; segments now
  // sit in a transparent track with the active segment marking itself.
  segmented: {
    flexDirection: "row",
    gap: 8,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    backgroundColor: "transparent",
  },
  segmentActive: {
    backgroundColor: C.surface,
    borderColor: C.textSecondary,
  },
  segmentInner: { flexDirection: "row", alignItems: "center" },
  segmentText: { fontSize: 14, fontWeight: "600", color: C.textSecondary },
  segmentTextActive: { color: C.textPrimary },
  windowHint: {
    fontSize: 12,
    color: C.textTertiary,
    marginLeft: 4,
    marginTop: 2,
  },

  // Activity expanded-slot styles. Pass 26-followup-2: target inputs use
  // the same subtle-box treatment as nameInput. Mirrors Pack Name's
  // affordance pattern; eliminates the bottom-hairline-only flatness that
  // read as display values rather than editable inputs.
  inlineInput: {
    fontSize: 15,
    color: C.textPrimary,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    borderRadius: 8,
    backgroundColor: "transparent",
  },
  // Scoring — Pass 26-followup-3-followup-2: whole-row Pressable wraps the
  // teaser text + trailing info icon. flex: 1 on scoringText pushes the
  // icon to the row's trailing edge regardless of text length and lets
  // long copy wrap correctly inside the row.
  scoringRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  scoringText: {
    flex: 1,
    fontSize: 13,
    color: C.textTertiary,
    lineHeight: 20,
    marginLeft: 4,
  },
});
