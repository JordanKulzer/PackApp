// Pack Edit screen. Modal-presented from the pack header menu.
//
// Owner-only — server-side ownership is re-checked in update_pack_settings;
// the client gate below is UX-only (avoids a flash of form for non-owners).
//
// Editable fields:
//   - Pack name (immediate apply)
//
// Goal-removal Part 1: step / calorie / water target editing dropped.
// The categories pivot replaced goal-hit scoring with per-category daily
// winners, so user-editable goal numbers no longer carry meaning. The
// goal-target columns + pending_* columns on packs remain in the DB
// (harmless); the RPC update_pack_settings no longer accepts goal-target
// params (see migration 20260524_pack_rpcs_drop_goal_targets).
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

// Goal-removal Part 1: bounds (STEP_MIN/MAX, CALORIE_MIN/MAX, WATER_MIN/MAX),
// the formatNextRunDate / computeNextRunStart helpers, and the
// UpdatePackSettingsResponse interface have all been dropped along with
// the goal-target editing flow. NAME_MAX_LENGTH retained for the name
// input's maxLength prop.
const NAME_MAX_LENGTH = 40;

interface InitialValues {
  name: string;
}

export default function EditPackScreen() {
  const { id: packId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { data: packData, isLoading: packLoading } = usePack(packId ?? null);

  const [name, setName] = useState("");
  const [initial, setInitial] = useState<InitialValues | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Goal-removal Part 1: target useStates + their pending-or-live
  // pre-population dropped. Only the name field remains on the form.
  useEffect(() => {
    if (!packData) return;
    const p = packData.pack;
    const next: InitialValues = { name: p.name };
    setName(next.name);
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

  // Goal-removal Part 1: goal-bound validation (steps/calories/water
  // ranges) dropped. Only the name field needs validation now.
  const validate = (): string | null => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return packEdit.validation.nameRequired;
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

    // Goal-removal Part 1: goal-target diff branches dropped. Only the
    // name-change branch remains.
    const pack = packData.pack;
    const trimmedName = name.trim();
    const nameChanged = trimmedName !== initial.name;

    setSaving(true);
    const { error: rpcError } = await supabase.rpc("update_pack_settings", {
      p_pack_id: pack.id,
      p_name: nameChanged ? trimmedName : null,
    });
    setSaving(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    // Goal-removal Part 1: the goals_updated activity_feed insert path,
    // its push, and the "applies at {date}" caption are gone. Pack Detail's
    // useFocusEffect handles refetch on modal dismiss; no local refetch
    // needed before unmount.

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

    // Goal-removal Part 1: toast variants tied to goal changes
    // (bothChanged / goalsApplyAt) dropped — only name-change and
    // no-change paths remain.
    if (nameChanged) {
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

  // Goal-removal Part 1: nextRunDateLabel + anyGoalEnabled derivations
  // dropped — the only consumers were the Goal Targets section header
  // and its visibility gate, both removed below.

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

        {/* Goal-removal Part 1: the entire Goal Targets card (steps /
            calories / water TextInputs, the next-run-date header, and its
            anyGoalEnabled visibility gate) has been removed. */}

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
});
