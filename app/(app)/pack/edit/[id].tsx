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
  Alert,
  Image,
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
import { removeMember } from "../../../../src/lib/packLifecycle";
import { formatName, getInitial } from "../../../../src/lib/displayName";

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
  // Per-category "did pending_*_enabled exist (non-null) at form-seed?"
  // snapshot. Used by the post-save toast to distinguish queued-this-save
  // (false → true) from cancelled-this-save (true → false). The seed
  // useEffect folds the actual pending booleans into `effective` via ??,
  // which loses the null/non-null distinction; this field preserves it.
  pendingExistedBefore: {
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
  const { data: packData, isLoading: packLoading, refetch: refetchPack } =
    usePack(packId ?? null);

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
      pendingExistedBefore: {
        steps: p.pending_steps_enabled !== null,
        workouts: p.pending_workouts_enabled !== null,
        calories: p.pending_calories_enabled !== null,
        water: p.pending_water_enabled !== null,
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

    // RPC's aggregate post-save flag — kept as a sanity reference but
    // NOT used for branching the toast. The toast uses the two
    // per-category facts below (anyQueued / anyCancelled), which are
    // derivable client-side from what the handler sent vs. what existed
    // at form-seed. The aggregate bool collapses queued + cancelled +
    // untouched into one truthy value and loses the cancel signal.
    // Intentionally suppressed via `void` so tsc doesn't flag unused.
    void (rpcData as { has_pending_category_change?: boolean } | null)
      ?.has_pending_category_change;

    // Per-category post-save state, derived from the param the handler
    // just sent + the live value:
    //   param === null              → unchanged from pendingBefore
    //   param !== null, !== live    → pending now exists (queued)
    //   param !== null, === live    → RPC will clear pending (cancelled)
    type Cat = "steps" | "workouts" | "calories" | "water";
    const sent: Record<Cat, boolean | null> = {
      steps: pendingSteps,
      workouts: pendingWorkouts,
      calories: pendingCalories,
      water: pendingWater,
    };
    const before = initial.pendingExistedBefore;
    const live = initial.live;
    const after: Record<Cat, boolean> = {
      steps:
        sent.steps === null
          ? before.steps
          : sent.steps !== live.steps,
      workouts:
        sent.workouts === null
          ? before.workouts
          : sent.workouts !== live.workouts,
      calories:
        sent.calories === null
          ? before.calories
          : sent.calories !== live.calories,
      water:
        sent.water === null
          ? before.water
          : sent.water !== live.water,
    };
    // Queued: any category that did NOT have a pending before but does
    // after — a fresh queue this save. (A user replacing one pending
    // with a different pending value is a no-op semantically since
    // pending state is binary; the value just gets overwritten.)
    const anyQueued = (["steps", "workouts", "calories", "water"] as Cat[])
      .some((c) => after[c] && !before[c]);
    // Cancelled: any category that had a pending before but doesn't
    // after.
    const anyCancelled = (["steps", "workouts", "calories", "water"] as Cat[])
      .some((c) => before[c] && !after[c]);

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

    // Toast: branch on (nameChanged, anyQueued, anyCancelled). The
    // cancel and both-happened branches are checked BEFORE noChanges so
    // a revert never falls through to "No changes." Six category-
    // related variants cover the cross-product of name × (queued /
    // cancelled / both); the "both queued AND cancelled in one save"
    // case uses the "updated" wording rather than enumerating sides.
    const period = pack.competition_window === "monthly" ? "month" : "week";
    if (nameChanged && anyQueued && anyCancelled) {
      showToast({
        message: packEdit.toast.bothChangedCategoriesUpdated,
        kind: "success",
      });
    } else if (nameChanged && anyQueued) {
      showToast({
        message: t(packEdit.toast.bothChangedCategories, { period }),
        kind: "success",
      });
    } else if (nameChanged && anyCancelled) {
      showToast({
        message: packEdit.toast.bothChangedCategoriesCancelled,
        kind: "success",
      });
    } else if (anyQueued && anyCancelled) {
      showToast({
        message: packEdit.toast.categoriesUpdated,
        kind: "success",
      });
    } else if (anyQueued) {
      showToast({
        message: t(packEdit.toast.categoriesApplyAt, { period }),
        kind: "success",
      });
    } else if (anyCancelled) {
      showToast({
        message: packEdit.toast.categoriesCancelled,
        kind: "success",
      });
    } else if (nameChanged) {
      showToast({ message: packEdit.toast.nameUpdated, kind: "success" });
    } else {
      showToast({ message: packEdit.toast.noChanges, kind: "info" });
    }

    router.dismiss();
  };

  // Phase 4: owner removes a member.
  //
  // Confirmation: native Alert with destructive style on the confirm
  // button. The RPC raises if the target isn't a current active member
  // (stale UI / double-tap race); that's surfaced as a friendly
  // "Already removed" toast rather than a raw RPC message. All other
  // RPC errors surface their message verbatim.
  //
  // On success: refetchPack to drop the removed row from the list
  // immediately (usePack auto-refetches on focus but Edit Pack stays
  // mounted while the user is still here). No optimistic update — the
  // RPC round-trip is short and the auth gate is server-side, so we
  // wait for the truth before mutating local state.
  const handleRemoveMember = (memberUserId: string, memberName: string) => {
    if (!packData) return;
    const packId = packData.pack.id;
    Alert.alert(
      t(packEdit.members.confirmTitle, { name: memberName }),
      packEdit.members.confirmBody,
      [
        { text: packEdit.members.confirmCancel, style: "cancel" },
        {
          text: packEdit.members.confirmRemove,
          style: "destructive",
          onPress: async () => {
            try {
              await removeMember(packId, memberUserId);
              await refetchPack();
              showToast({
                message: t(packEdit.members.toastRemoved, { name: memberName }),
                kind: "success",
              });
            } catch (e) {
              const msg = (e as Error).message ?? "";
              if (/not an active member/i.test(msg)) {
                showToast({
                  message: packEdit.members.toastAlreadyRemoved,
                  kind: "info",
                });
                // Refresh so the stale row disappears for the next try.
                await refetchPack();
              } else {
                showToast({ message: msg || "Failed to remove", kind: "error" });
              }
            }
          },
        },
      ],
    );
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

        {/* Phase 4: Members list. Owner-only screen (the owner gate
            above bounces non-owners), so every viewer here is the
            owner. Per-row Remove visible for every member EXCEPT the
            owner's own row (the RPC rejects self-removal; don't surface
            an always-erroring button). Data: usePack already fetches
            members filtered to is_active=true with the joined user
            row, so no extra fetch is needed. */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {packEdit.members.sectionLabel}
          </Text>
          <View style={styles.memberList}>
            {packData.members.map((m, idx) => {
              // The PackMemberWithUser TypeScript interface claims a
              // nested `.user` object, but the actual SELECT in usePack
              // is `"*, users(*)"` — PostgREST returns the joined row
              // under the TABLE name `users` (plural), not `user`. The
              // interface is a lie at runtime. Pack Detail's
              // memberNameMap/memberAvatarMap build (pack/[id].tsx
              // ~lines 2716-2729) uses the same cast — mirroring it
              // here keeps both consumers reading the field that
              // actually exists.
              const u = (
                m as unknown as {
                  users: {
                    display_name: string | null;
                    avatar_url: string | null;
                  } | null;
                }
              ).users;
              const rawName = u?.display_name ?? null;
              const avatarUrl = u?.avatar_url ?? null;
              const isOwn = m.user_id === user.id;
              const displayName = formatName(rawName);
              const initial = getInitial(rawName);
              return (
                <View
                  key={m.user_id}
                  style={[
                    styles.memberRow,
                    idx === packData.members.length - 1 &&
                      styles.memberRowLast,
                  ]}
                >
                  <View style={styles.memberAvatar}>
                    {avatarUrl ? (
                      <Image
                        source={{ uri: avatarUrl }}
                        style={styles.memberAvatarImage}
                      />
                    ) : (
                      <Text style={styles.memberAvatarInitial}>
                        {initial}
                      </Text>
                    )}
                  </View>
                  <Text style={styles.memberName} numberOfLines={1}>
                    {displayName}
                  </Text>
                  {!isOwn && (
                    <TouchableOpacity
                      onPress={() =>
                        handleRemoveMember(m.user_id, displayName)
                      }
                      style={styles.memberRemoveBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.memberRemoveText}>
                        {packEdit.members.removeButton}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>
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
  // Members section: same chrome as categoryList — surface-tinted
  // container with hairline-separated rows. Avatar 32pt + name + right-
  // aligned destructive-tinted "Remove" button. The owner's own row
  // omits the button entirely (RPC rejects self-removal anyway).
  memberList: {
    borderWidth: 1,
    borderColor: "#374151",
    borderRadius: 12,
    backgroundColor: "#1F2937",
    paddingHorizontal: 14,
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#374151",
  },
  memberRowLast: {
    borderBottomWidth: 0,
  },
  memberAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#1C2333",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  memberAvatarImage: {
    width: 32,
    height: 32,
  },
  memberAvatarInitial: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  memberName: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  memberRemoveBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  memberRemoveText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#F85149",
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
