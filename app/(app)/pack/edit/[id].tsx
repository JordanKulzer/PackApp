// Pack Edit screen (Pass 20c). Modal-presented from the pack header menu.
//
// Owner-only — server-side ownership is re-checked in update_pack_settings;
// the client gate below is UX-only (avoids a flash of form for non-owners).
//
// Editable fields:
//   - Pack name (immediate apply)
//   - Step / Calorie / Water targets — queue for next run rollover (D5)
//
// Workout target editing intentionally not in this pass (D2 deferred).
//
// Pre-population per field uses pending_X ?? live_X (D6 — the form shows
// the user's prior queued intent, not the live value being competed under).
//
// Save payload (D-CLIENT-PATTERN B): for goal fields we send the current
// input value only when it differs from its pre-pop value; otherwise NULL,
// which the RPC's COALESCE preserves as the existing pending state.
//
// Bounds (cross-referenced with the RPC; keep in sync if either changes):
//   step_target:      1000 – 50000
//   calorie_target:    100 – 2000
//   water_target_oz:    16 –  256
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

// Bounds — KEEP IN SYNC with update_pack_settings RPC
// (supabase/migrations/20260505c_pack_edit_update_settings_rpc.sql).
const STEP_MIN = 1000;
const STEP_MAX = 50000;
const CALORIE_MIN = 100;
const CALORIE_MAX = 2000;
const WATER_MIN = 16;
const WATER_MAX = 256;
const NAME_MAX_LENGTH = 40;

interface InitialValues {
  name: string;
  stepTarget: string;
  calorieTarget: string;
  waterTarget: string;
}

interface UpdatePackSettingsResponse {
  pack_id: string;
  name: string;
  has_pending_changes: boolean;
  next_run_start: string;
}

function formatNextRunDate(isoDate: string): string {
  // Parse at noon to avoid UTC-midnight off-by-one across timezones.
  // Explicit "en-US" locale — pre-launch app is English-only; relying on
  // device default would produce surprise formats on non-English devices.
  const d = new Date(isoDate + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

// Computes the YYYY-MM-DD of the next Monday — the date pending changes
// will apply on. Authoritative source is the active run's end_date + 1
// (Sunday + 1 = Monday under the Mon-Sun convention enforced by
// rollover_expired_runs and create_pack_with_run, Pass 18-C.2d). JS
// fallback handles the rare case where activeRun is null.
function computeNextRunStart(
  activeRun: { end_date: string } | null,
): string {
  if (activeRun?.end_date) {
    const d = new Date(activeRun.end_date + "T12:00:00");
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  }
  const today = new Date();
  const dow = today.getDay(); // 0=Sun..6=Sat
  // Days to next Monday: today=Mon → 7, today=Sun → 1, else 8 - dow.
  const daysAhead = dow === 1 ? 7 : dow === 0 ? 1 : 8 - dow;
  const next = new Date(today);
  next.setDate(today.getDate() + daysAhead);
  return next.toISOString().split("T")[0];
}

export default function EditPackScreen() {
  const { id: packId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { data: packData, isLoading: packLoading } = usePack(packId ?? null);

  const [name, setName] = useState("");
  const [stepTarget, setStepTarget] = useState("");
  const [calorieTarget, setCalorieTarget] = useState("");
  const [waterTarget, setWaterTarget] = useState("");
  const [initial, setInitial] = useState<InitialValues | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-populate: pending ?? live (D6).
  useEffect(() => {
    if (!packData) return;
    const p = packData.pack;
    const next: InitialValues = {
      name: p.name,
      stepTarget: String(p.pending_step_target ?? p.step_target),
      calorieTarget: String(p.pending_calorie_target ?? p.calorie_target),
      waterTarget: String(p.pending_water_target_oz ?? p.water_target_oz),
    };
    setName(next.name);
    setStepTarget(next.stepTarget);
    setCalorieTarget(next.calorieTarget);
    setWaterTarget(next.waterTarget);
    setInitial(next);
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

  const validate = (): string | null => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return packEdit.validation.nameRequired;

    const pack = packData?.pack;
    if (!pack) return null;

    if (pack.steps_enabled) {
      const n = parseInt(stepTarget, 10);
      if (isNaN(n) || n < STEP_MIN || n > STEP_MAX) {
        return packEdit.validation.stepRange;
      }
    }
    if (pack.calories_enabled) {
      const n = parseInt(calorieTarget, 10);
      if (isNaN(n) || n < CALORIE_MIN || n > CALORIE_MAX) {
        return packEdit.validation.calorieRange;
      }
    }
    if (pack.water_enabled) {
      const n = parseInt(waterTarget, 10);
      if (isNaN(n) || n < WATER_MIN || n > WATER_MAX) {
        return packEdit.validation.waterRange;
      }
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

    // Build payload with NULL for unchanged fields (D-CLIENT-PATTERN B).
    const pack = packData.pack;
    const trimmedName = name.trim();
    const nameChanged = trimmedName !== initial.name;
    const stepChanged =
      pack.steps_enabled && stepTarget !== initial.stepTarget;
    const calorieChanged =
      pack.calories_enabled && calorieTarget !== initial.calorieTarget;
    const waterChanged =
      pack.water_enabled && waterTarget !== initial.waterTarget;

    setSaving(true);
    const { data, error: rpcError } = await supabase.rpc(
      "update_pack_settings",
      {
        p_pack_id: pack.id,
        p_name: nameChanged ? trimmedName : null,
        p_pending_step_target: stepChanged ? parseInt(stepTarget, 10) : null,
        p_pending_calorie_target: calorieChanged
          ? parseInt(calorieTarget, 10)
          : null,
        p_pending_water_target_oz: waterChanged
          ? parseInt(waterTarget, 10)
          : null,
      },
    );
    setSaving(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    // Pack Detail's useFocusEffect handles refetch on modal dismiss
    // (Pass A); no local refetch needed before unmount.
    const goalsChanged = stepChanged || calorieChanged || waterChanged;

    // Compute the next-run date label once, used by:
    //   1. goals_updated activity_feed row's `caption` (read by SystemMessageRow)
    //   2. goals_updated push notification payload (formatted by edge function)
    //   3. toast variants (existing behavior)
    const response = data as UpdatePackSettingsResponse | null;
    const nextRunStart = response?.next_run_start ?? "";
    const dateLabel = nextRunStart ? formatNextRunDate(nextRunStart) : "";

    // Pass 20d/20e: when goal targets change, insert a goals_updated system
    // message into the pack's activity feed and fire a push to other
    // members. Plain INSERT (not upsert) — the dedup index
    // idx_activity_feed_no_dup_goals is a PARTIAL unique index (it has a
    // WHERE clause), and supabase-js's upsert + onConflict can't match
    // partial indexes; Postgres throws 42P10. The same partial index still
    // enforces uniqueness on INSERT, so a same-day duplicate raises 23505,
    // which we treat as the dedup no-op (matches the original intent of
    // ignoreDuplicates: true). See Pass 9 memory: this exact pattern
    // applies to syncWater/logActivity/healthkit too.
    //
    // `caption: dateLabel` (Pass 20e): SystemMessageRow reads this column
    // to render "Goals updated · Applied {date}" — the date is captured at
    // insert time so the chat row is historically accurate even if the
    // pack timezone or run schedule changes later.
    if (goalsChanged) {
      const today = packToday(pack.timezone ?? "UTC");
      const { data: inserted, error: feedError } = await supabase
        .from("activity_feed")
        .insert({
          pack_id: pack.id,
          user_id: user.id,
          activity_type: "goals_updated",
          value: 0,
          points_earned: 0,
          entry_method: "system",
          score_date: today,
          caption: dateLabel || null,
        })
        .select("id");
      if (feedError) {
        // 23505 = unique violation on the partial index = same-day dedup
        // hit. Silent no-op (matches the dedup intent). Other errors are
        // real and surface in the console for diagnosis.
        if (feedError.code !== "23505") {
          console.error("[EditPack] goals_updated insert error:", feedError);
        }
      } else if (inserted && inserted.length > 0) {
        notifyPackMembers(user.id, pack.id, {
          kind: "goals_updated",
          nextRunStart,
        }).catch(() => {});
      }
    }

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

    if (goalsChanged && nameChanged && dateLabel) {
      showToast({
        message: t(packEdit.toast.bothChanged, { date: dateLabel }),
        kind: "success",
      });
    } else if (goalsChanged && dateLabel) {
      showToast({
        message: t(packEdit.toast.goalsApplyAt, { date: dateLabel }),
        kind: "success",
      });
    } else if (nameChanged) {
      showToast({ message: packEdit.toast.nameUpdated, kind: "success" });
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

  const pack = packData.pack;
  const nextRunDateLabel = formatNextRunDate(
    computeNextRunStart(packData.activeRun ?? null),
  );
  const anyGoalEnabled =
    pack.steps_enabled || pack.calories_enabled || pack.water_enabled;

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
          disabled={saving}
          style={styles.saveBtn}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Text style={styles.saveBtnText}>{packEdit.screen.save}</Text>
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

        {/* Goal targets — queue for next run rollover. Section header
            carries the queueing semantic with the apply date. Each field
            is conditional on its pack-enabled flag; the surrounding card
            and the dividers between fields handle missing fields cleanly
            (no leading/trailing/double dividers). */}
        {anyGoalEnabled && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {t(packEdit.screen.goalTargetsHeader, {
                date: nextRunDateLabel.toUpperCase(),
              })}
            </Text>
            <View style={styles.card}>
              {pack.steps_enabled && (
                <View style={styles.cardField}>
                  <Text style={styles.cardFieldLabel}>
                    {packEdit.screen.stepTargetLabel}
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={stepTarget}
                    onChangeText={setStepTarget}
                    keyboardType="number-pad"
                    placeholderTextColor="#9CA3AF"
                  />
                </View>
              )}
              {pack.steps_enabled &&
                (pack.calories_enabled || pack.water_enabled) && (
                  <View style={styles.cardDivider} />
                )}
              {pack.calories_enabled && (
                <View style={styles.cardField}>
                  <Text style={styles.cardFieldLabel}>
                    {packEdit.screen.calorieTargetLabel}
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={calorieTarget}
                    onChangeText={setCalorieTarget}
                    keyboardType="number-pad"
                    placeholderTextColor="#9CA3AF"
                  />
                </View>
              )}
              {pack.calories_enabled && pack.water_enabled && (
                <View style={styles.cardDivider} />
              )}
              {pack.water_enabled && (
                <View style={styles.cardField}>
                  <Text style={styles.cardFieldLabel}>
                    {packEdit.screen.waterTargetLabel}
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={waterTarget}
                    onChangeText={setWaterTarget}
                    keyboardType="number-pad"
                    placeholderTextColor="#9CA3AF"
                  />
                </View>
              )}
            </View>
          </View>
        )}

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
  errorBanner: {
    backgroundColor: "rgba(248, 81, 73, 0.12)",
    borderWidth: 1,
    borderColor: "#F85149",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  errorText: { fontSize: 14, color: "#F85149" },
  // Goal-targets grouping card. Mirrors the create.tsx Activities pattern:
  // dark surface, hairline border, hairline dividers between rows. Each
  // cardField preserves the existing label-above + full-width-input-below
  // structure (additive change — no input-style transformation).
  card: {
    backgroundColor: "#111827",
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1F2937",
  },
  cardField: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  cardFieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9CA3AF",
    textTransform: "uppercase",
    letterSpacing: 0.08 * 11,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#1F2937",
  },
});
