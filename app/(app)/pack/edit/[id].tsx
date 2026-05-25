// Pack Edit screen. Modal-presented from the pack header menu.
//
// Owner-only — server-side ownership is re-checked in update_pack_settings;
// the client gate below is UX-only (avoids a flash of form for non-owners).
//
// Editable fields:
//   - Pack name (immediate apply)
//   - Category enable toggles (steps/workouts/calories/water) — Phase 2:
//     queued to pending_*_enabled, apply at the next run rollover.
//
// Goal-removal Part 1: step / calorie / water target editing dropped.
// The categories pivot replaced goal-hit scoring with per-category daily
// winners, so user-editable goal numbers no longer carry meaning. The
// goal-target columns + pending_*_target columns on packs remain in the
// DB (harmless); the RPC update_pack_settings no longer accepts
// goal-target params (see migration 20260524_pack_rpcs_drop_goal_targets).
//
// Phase 2 (2026-05-25): update_pack_settings is now a 6-param RPC —
// (p_pack_id, p_name, p_pending_{steps,workouts,calories,water}_enabled).
// The old 2-param version is DROPPED, so this screen's save must always
// pass all six. Category-enable changes write to pending_*_enabled (NOT
// the live columns) and apply at the next rollover.
//
// Modal close MUST use router.dismiss() per the layout file convention.

import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuthStore } from "../../../../src/stores/authStore";
import { supabase } from "../../../../src/lib/supabase";
import { usePack } from "../../../../src/hooks/usePack";
import { showToast } from "../../../../src/lib/toast";
import { notifyPackMembers } from "../../../../src/lib/notifications";
import { packToday } from "../../../../src/lib/packDates";
import { colors } from "../../../../src/theme/colors";
import { packEdit, t } from "../../../../src/constants/strings";
import { ActivityToggleRow } from "../../../../src/components/profile/ActivityToggleRow";

// Goal-removal Part 1: bounds (STEP_MIN/MAX, CALORIE_MIN/MAX, WATER_MIN/MAX),
// the formatNextRunDate / computeNextRunStart helpers, and the
// UpdatePackSettingsResponse interface have all been dropped along with
// the goal-target editing flow. NAME_MAX_LENGTH retained for the name
// input's maxLength prop.
const NAME_MAX_LENGTH = 40;

// "Live AND effective" snapshot at form-load — used to seed the toggles
// and to diff at save time. Each toggle's INITIAL display value is the
// EFFECTIVE state (pending if non-null, else live) so the toggle reflects
// "what the category WILL be after rollover."
//
// At save time the diff is against `effective`, NOT `live`: a toggle that
// matches `live` but differs from `effective` (i.e. the user reverted a
// queued pending change) is a real action that must reach the RPC.
// Sending the toggle's boolean in that case lets the RPC's CASE clause
// (param == live → pending = NULL) clear the pending column. The earlier
// `toggle !== live` check sent null in the revert case and the RPC had
// nothing to act on — pending stayed stuck.
interface InitialValues {
  name: string;
  live: {
    steps: boolean;
    workouts: boolean;
    calories: boolean;
    water: boolean;
  };
  effective: {
    steps: boolean;
    workouts: boolean;
    calories: boolean;
    water: boolean;
  };
}

export default function EditPackScreen() {
  const { id: packId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { data: packData, isLoading: packLoading } = usePack(packId ?? null);

  const [name, setName] = useState("");
  const [stepsEnabled, setStepsEnabled] = useState(true);
  const [workoutsEnabled, setWorkoutsEnabled] = useState(true);
  const [caloriesEnabled, setCaloriesEnabled] = useState(true);
  const [waterEnabled, setWaterEnabled] = useState(true);
  const [initial, setInitial] = useState<InitialValues | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the form. For each category: prefer the pending value if one
  // is queued (pending_*_enabled non-null) so the toggle shows the
  // EFFECTIVE state after rollover; else show the live value. The
  // `initial.live.*` snapshot is what save-time diffs against — toggle
  // == live → pass null (no change), toggle != live → pass the boolean.
  useEffect(() => {
    if (!packData) return;
    const p = packData.pack;
    const effSteps    = p.pending_steps_enabled    ?? p.steps_enabled;
    const effWorkouts = p.pending_workouts_enabled ?? p.workouts_enabled;
    const effCalories = p.pending_calories_enabled ?? p.calories_enabled;
    const effWater    = p.pending_water_enabled    ?? p.water_enabled;
    setName(p.name);
    setStepsEnabled(effSteps);
    setWorkoutsEnabled(effWorkouts);
    setCaloriesEnabled(effCalories);
    setWaterEnabled(effWater);
    setInitial({
      name: p.name,
      live: {
        steps: p.steps_enabled,
        workouts: p.workouts_enabled,
        calories: p.calories_enabled,
        water: p.water_enabled,
      },
      effective: {
        steps: effSteps,
        workouts: effWorkouts,
        calories: effCalories,
        water: effWater,
      },
    });
  }, [packData]);

  // Owner gate (UX only — RPC re-checks server-side).
  // While packData is loading we render the spinner; once loaded, a
  // non-owner is bounced via router.dismiss().
  useEffect(() => {
    if (!packData || !user) return;
    if (packData.pack.created_by !== user.id) {
      router.dismiss();
    }
  }, [packData, user, router]);

  // Validate: name non-empty + at least one category enabled. The RPC
  // re-checks the category guard server-side; this is the friendly
  // client-side block to avoid surfacing a raw RPC error string.
  const validate = (): string | null => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return packEdit.validation.nameRequired;
    if (
      !stepsEnabled &&
      !workoutsEnabled &&
      !caloriesEnabled &&
      !waterEnabled
    ) {
      return packEdit.validation.atLeastOneCategory;
    }
    return null;
  };

  const handleSave = async () => {
    if (saving || !packData || !initial || !user) return;

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);

    const pack = packData.pack;
    const trimmedName = name.trim();
    const nameChanged = trimmedName !== initial.name;

    // For each category, decide what to send as p_pending_*_enabled.
    //
    // Diff axis is EFFECTIVE (pending if queued, else live) — NOT live.
    // Diffing against live alone misses the "revert a queued pending"
    // case: toggle ends up equal to live but differs from effective, so
    // the user's intent IS a real action (cancel the pending). Sending
    // the boolean in that case lets the RPC's CASE clause clear the
    // pending column (param == live → pending = NULL).
    //
    // Rule: if toggle == effective → null (genuine no-op). Otherwise
    // send the toggle's boolean and let the RPC decide whether to set,
    // clear, or re-stamp pending_*_enabled.
    const pendingSteps    = stepsEnabled    !== initial.effective.steps    ? stepsEnabled    : null;
    const pendingWorkouts = workoutsEnabled !== initial.effective.workouts ? workoutsEnabled : null;
    const pendingCalories = caloriesEnabled !== initial.effective.calories ? caloriesEnabled : null;
    const pendingWater    = waterEnabled    !== initial.effective.water    ? waterEnabled    : null;

    setSaving(true);
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "update_pack_settings",
      {
        p_pack_id: pack.id,
        p_name: nameChanged ? trimmedName : null,
        p_pending_steps_enabled: pendingSteps,
        p_pending_workouts_enabled: pendingWorkouts,
        p_pending_calories_enabled: pendingCalories,
        p_pending_water_enabled: pendingWater,
      },
    );
    setSaving(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    const hasPendingCategoryChange =
      (rpcData as { has_pending_category_change?: boolean } | null)
        ?.has_pending_category_change ?? false;

    // Pass 20e: when the pack name changes, insert a pack_renamed system
    // message and fire a push. Same insert + 23505 catch pattern as
    // goals_updated. `caption: trimmedName` stores the new name at insert
    // time so each historical rename row preserves its own value (no live
    // join means future renames don't mutate old messages).
    if (nameChanged) {
      const today = packToday(pack.timezone ?? "UTC");
      const { data: insertedRename, error: renameError } = await supabase
        .from("activity_feed")
        .insert({
          pack_id: pack.id,
          user_id: user.id,
          activity_type: "pack_renamed",
          value: 0,
          points_earned: 0,
          entry_method: "system",
          score_date: today,
          caption: trimmedName,
        })
        .select("id");
      if (renameError) {
        if (renameError.code !== "23505") {
          console.error("[EditPack] pack_renamed insert error:", renameError);
        }
      } else if (insertedRename && insertedRename.length > 0) {
        notifyPackMembers(user.id, pack.id, {
          kind: "pack_renamed",
          newName: trimmedName,
        }).catch(() => {});
      }
    }

    // Toast: branch on (nameChanged, hasPendingCategoryChange).
    // `hasPendingCategoryChange` reflects the post-save pending state,
    // so a user who opened with pending=on and didn't touch the toggles
    // still gets the "applies next period" message — accurate, the
    // queued change is still pending.
    const period = pack.competition_window === "monthly" ? "month" : "week";
    if (nameChanged && hasPendingCategoryChange) {
      showToast({
        message: t(packEdit.toast.bothChangedCategories, { period }),
        kind: "success",
      });
    } else if (nameChanged) {
      showToast({ message: packEdit.toast.nameUpdated, kind: "success" });
    } else if (hasPendingCategoryChange) {
      showToast({
        message: t(packEdit.toast.categoriesApplyAt, { period }),
        kind: "success",
      });
    } else {
      showToast({ message: packEdit.toast.noChanges, kind: "info" });
    }

    router.dismiss();
  };

  // Loading or pending owner-redirect — render the spinner. The owner
  // gate's router.dismiss() runs in an effect; until it does, returning
  // early keeps the form from flashing for non-owners.
  if (packLoading || !packData || !user || packData.pack.created_by !== user.id) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="small" color={colors.accent} />
      </View>
    );
  }

  // Derived state for the categories section.
  // `hasPendingCategoryChange` drives the inline "applies at next reset"
  // hint — any toggle differing from its live value means a pending
  // change either exists already (seeded from packData) or is about to
  // be queued on save. `allCategoriesOff` drives Save-button disable +
  // the inline guard error (the RPC also raises but this is friendlier).
  const hasPendingCategoryChange =
    initial !== null &&
    (stepsEnabled !== initial.live.steps ||
      workoutsEnabled !== initial.live.workouts ||
      caloriesEnabled !== initial.live.calories ||
      waterEnabled !== initial.live.water);
  const allCategoriesOff =
    !stepsEnabled &&
    !workoutsEnabled &&
    !caloriesEnabled &&
    !waterEnabled;
  const period =
    packData.pack.competition_window === "monthly" ? "month" : "week";

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.dismiss()}
          style={styles.backBtn}
        >
          <Text style={styles.backText}>{packEdit.screen.cancel}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{packEdit.screen.title}</Text>
        <TouchableOpacity
          onPress={handleSave}
          disabled={saving || allCategoriesOff}
          style={styles.saveBtn}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Text
              style={[
                styles.saveBtnText,
                allCategoriesOff && styles.saveBtnTextDisabled,
              ]}
            >
              {packEdit.screen.save}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Pack name — immediate apply on save */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{packEdit.screen.nameLabel}</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            maxLength={NAME_MAX_LENGTH}
            placeholderTextColor="#9CA3AF"
          />
        </View>

        {/* Goal-removal Part 1: the entire Goal Targets card (steps /
            calories / water TextInputs, the next-run-date header, and its
            anyGoalEnabled visibility gate) has been removed.
            Phase 2 (2026-05-25): replaced by the category-enable toggles
            below — same 4 ActivityToggleRow rows as Create Pack, but
            changes write to pending_*_enabled and apply at rollover. */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {packEdit.screen.categoriesLabel}
          </Text>
          <View style={styles.categoryList}>
            <ActivityToggleRow
              label="Steps"
              description="Synced from HealthKit or logged manually"
              value={stepsEnabled}
              onValueChange={setStepsEnabled}
            />
            <ActivityToggleRow
              label="Workouts"
              description="Any workout logged"
              value={workoutsEnabled}
              onValueChange={setWorkoutsEnabled}
            />
            <ActivityToggleRow
              label="Active Calories"
              description="From HealthKit or logged manually"
              value={caloriesEnabled}
              onValueChange={setCaloriesEnabled}
            />
            <ActivityToggleRow
              label="Water"
              description="From HealthKit or logged in oz"
              value={waterEnabled}
              onValueChange={setWaterEnabled}
              isLast
            />
          </View>
          {hasPendingCategoryChange && (
            <Text style={styles.pendingHint}>
              {t(packEdit.screen.categoriesPendingHint, { period })}
            </Text>
          )}
        </View>

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#0A0A0A" },
  loadingScreen: {
    flex: 1,
    backgroundColor: "#0A0A0A",
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 14,
    backgroundColor: "#0A0A0A",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1F2937",
  },
  backBtn: { minWidth: 60 },
  backText: { fontSize: 16, color: "#9CA3AF" },
  headerTitle: { fontSize: 17, fontWeight: "700", color: "#FFFFFF" },
  saveBtn: { minWidth: 60, alignItems: "flex-end" },
  saveBtnText: { fontSize: 16, fontWeight: "700", color: colors.accent },
  saveBtnTextDisabled: { color: "#4B5563" },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 24 },
  section: { gap: 10 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9CA3AF",
    textTransform: "uppercase",
    letterSpacing: 0.08 * 11,
  },
  input: {
    height: 50,
    borderWidth: 1,
    borderColor: "#374151",
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 16,
    color: "#FFFFFF",
    backgroundColor: "#1F2937",
  },
  // Category section: the 4 ActivityToggleRow rows sit inside a
  // surface-tinted container with the same chrome as the name input
  // (#1F2937 fill, #374151 border, 12pt radius) for visual consistency.
  // ActivityToggleRow renders its own row padding/dividers; this just
  // frames them as a group.
  categoryList: {
    borderWidth: 1,
    borderColor: "#374151",
    borderRadius: 12,
    backgroundColor: "#1F2937",
    paddingHorizontal: 14,
  },
  pendingHint: {
    fontSize: 13,
    color: "#9CA3AF",
    marginTop: 4,
    paddingHorizontal: 2,
  },
  errorBanner: {
    backgroundColor: "rgba(248, 81, 73, 0.12)",
    borderWidth: 1,
    borderColor: "#F85149",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  errorText: { fontSize: 14, color: "#F85149" },
});
