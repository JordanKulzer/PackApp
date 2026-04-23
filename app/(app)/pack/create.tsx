import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../../../src/stores/authStore";
import { supabase } from "../../../src/lib/supabase";
import { useIsPro } from "../../../src/hooks/useIsPro";
import { analytics } from "../../../src/lib/analytics";
import { colors } from "../../../src/theme/colors";
import { POINTS } from "../../../src/lib/scoring";
import { weekStartInPackTz, weekEndInPackTz, getDeviceTimezone } from "../../../src/lib/packDates";

function generateInviteCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

interface ToggleRowProps {
  label: string;
  description: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}

function ToggleRow({ label, description, value, onValueChange }: ToggleRowProps) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleInfo}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleDesc}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: "#374151", true: colors.accent }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

export default function CreatePack() {
  const router = useRouter();
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
  const [stepPoints, setStepPoints] = useState(String(POINTS.steps));
  const [workoutPoints, setWorkoutPoints] = useState(String(POINTS.workout));
  const [caloriePoints, setCaloriePoints] = useState(String(POINTS.calories));
  const [waterPoints, setWaterPoints] = useState(String(POINTS.water));
  const [editingPoints, setEditingPoints] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

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

      // Compute run window dates in the pack's timezone
      let runStartDate: string;
      let runEndDate: string;

      if (window === "monthly") {
        const now = new Intl.DateTimeFormat("en-CA", { timeZone: packTz }).format(new Date());
        const [year, month] = now.split("-").map(Number);
        const lastDay = new Date(year, month, 0).getDate();
        runStartDate = `${year}-${String(month).padStart(2, "0")}-01`;
        runEndDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      } else {
        runStartDate = weekStartInPackTz(packTz);
        runEndDate = weekEndInPackTz(packTz);
      }

      // Single atomic RPC: creates pack + pack_member + run in one transaction.
      // Uses SECURITY DEFINER so RLS on runs doesn't block the insert.
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
        run_start_date: runStartDate,
        run_end_date: runEndDate,
      });

      if (error) throw error;

      const packId = (data as { pack_id: string }).pack_id;
      // Replace create screen so Back from pack detail returns to Home, not here.
      router.replace(`/(app)/pack/${packId}`);
    } catch (error) {
      console.error("[PACK CREATE ERROR]", JSON.stringify(error, null, 2));
      Alert.alert("Failed to create pack", JSON.stringify(error));
    } finally {
      setIsLoading(false);
    }
  };

  const clampPoints = (val: string) => {
    const n = parseInt(val, 10);
    if (isNaN(n)) return val;
    return String(Math.min(50, Math.max(1, n)));
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.dismiss()} style={styles.backBtn}>
          <Text style={styles.backText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New Pack</Text>
        <TouchableOpacity
          onPress={handleCreate}
          disabled={isLoading}
          style={styles.saveBtn}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Text style={styles.saveBtnText}>Create</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* Pack name */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pack Name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Morning Warriors"
            placeholderTextColor="#9CA3AF"
            value={name}
            onChangeText={setName}
            maxLength={40}
          />
        </View>

        {/* Competition window */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Competition Window</Text>
          <View style={styles.segmented}>
            {(["weekly", "monthly"] as const).map((opt) => {
              const locked = opt === "monthly" && !isPro;
              return (
                <TouchableOpacity
                  key={opt}
                  style={[styles.segment, window === opt && styles.segmentActive]}
                  onPress={() => handleWindowPress(opt)}
                >
                  <View style={styles.segmentInner}>
                    <Text style={[styles.segmentText, window === opt && styles.segmentTextActive]}>
                      {opt === "weekly" ? "Weekly" : "Monthly"}
                    </Text>
                    {locked && (
                      <Ionicons name="lock-closed" size={12} color="#6B7280" style={{ marginLeft: 4 }} />
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
          {window === "monthly" && (
            <Text style={styles.windowHint}>Resets on the 1st of each month</Text>
          )}
        </View>

        {/* Activities */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Activities</Text>
          <View style={styles.card}>
            {/* Steps */}
            <ToggleRow
              label="Steps"
              description={`Target: ${stepTarget} steps (+${stepPoints} pts)`}
              value={stepsEnabled}
              onValueChange={setStepsEnabled}
            />
            {stepsEnabled && (
              <TextInput
                style={styles.inlineInput}
                placeholder="Step target"
                placeholderTextColor="#9CA3AF"
                keyboardType="number-pad"
                value={stepTarget}
                onChangeText={setStepTarget}
              />
            )}
            {isPro && stepsEnabled && (
              editingPoints === "steps" ? (
                <View style={styles.pointsRow}>
                  <Text style={styles.pointsLabel}>Points:</Text>
                  <TextInput
                    style={styles.pointsInput}
                    keyboardType="number-pad"
                    value={stepPoints}
                    onChangeText={setStepPoints}
                    onBlur={() => { setStepPoints(clampPoints(stepPoints)); setEditingPoints(null); }}
                    autoFocus
                    maxLength={2}
                  />
                  <Text style={styles.pointsRange}>(1–50)</Text>
                </View>
              ) : (
                <TouchableOpacity style={styles.editPointsBtn} onPress={() => setEditingPoints("steps")}>
                  <Text style={styles.editPointsText}>Edit points (+{stepPoints} pts)</Text>
                </TouchableOpacity>
              )
            )}

            <View style={styles.activityDivider} />

            {/* Workouts */}
            <ToggleRow
              label="Workouts"
              description={`Any workout logged (+${workoutPoints} pts)`}
              value={workoutsEnabled}
              onValueChange={setWorkoutsEnabled}
            />
            {workoutsEnabled && (
              <View style={styles.workoutInfo}>
                <Text style={styles.workoutInfoText}>1 per day — any logged workout counts</Text>
              </View>
            )}
            {isPro && workoutsEnabled && (
              editingPoints === "workouts" ? (
                <View style={styles.pointsRow}>
                  <Text style={styles.pointsLabel}>Points:</Text>
                  <TextInput
                    style={styles.pointsInput}
                    keyboardType="number-pad"
                    value={workoutPoints}
                    onChangeText={setWorkoutPoints}
                    onBlur={() => { setWorkoutPoints(clampPoints(workoutPoints)); setEditingPoints(null); }}
                    autoFocus
                    maxLength={2}
                  />
                  <Text style={styles.pointsRange}>(1–50)</Text>
                </View>
              ) : (
                <TouchableOpacity style={styles.editPointsBtn} onPress={() => setEditingPoints("workouts")}>
                  <Text style={styles.editPointsText}>Edit points (+{workoutPoints} pts)</Text>
                </TouchableOpacity>
              )
            )}

            <View style={styles.activityDivider} />

            {/* Active Calories */}
            <ToggleRow
              label="Active Calories"
              description={`Target: ${calorieTarget} cal (+${caloriePoints} pts)`}
              value={caloriesEnabled}
              onValueChange={setCaloriesEnabled}
            />
            {caloriesEnabled && (
              <TextInput
                style={styles.inlineInput}
                placeholder="Calorie target"
                placeholderTextColor="#9CA3AF"
                keyboardType="number-pad"
                value={calorieTarget}
                onChangeText={setCalorieTarget}
              />
            )}
            {isPro && caloriesEnabled && (
              editingPoints === "calories" ? (
                <View style={styles.pointsRow}>
                  <Text style={styles.pointsLabel}>Points:</Text>
                  <TextInput
                    style={styles.pointsInput}
                    keyboardType="number-pad"
                    value={caloriePoints}
                    onChangeText={setCaloriePoints}
                    onBlur={() => { setCaloriePoints(clampPoints(caloriePoints)); setEditingPoints(null); }}
                    autoFocus
                    maxLength={2}
                  />
                  <Text style={styles.pointsRange}>(1–50)</Text>
                </View>
              ) : (
                <TouchableOpacity style={styles.editPointsBtn} onPress={() => setEditingPoints("calories")}>
                  <Text style={styles.editPointsText}>Edit points (+{caloriePoints} pts)</Text>
                </TouchableOpacity>
              )
            )}

            <View style={styles.activityDivider} />

            {/* Water */}
            <ToggleRow
              label="Water"
              description={`Target: ${waterTarget} oz (+${waterPoints} pts)`}
              value={waterEnabled}
              onValueChange={setWaterEnabled}
            />
            {waterEnabled && (
              <TextInput
                style={[styles.inlineInput, styles.lastInline]}
                placeholder="Water target (oz)"
                placeholderTextColor="#9CA3AF"
                keyboardType="number-pad"
                value={waterTarget}
                onChangeText={setWaterTarget}
              />
            )}
            {isPro && waterEnabled && (
              editingPoints === "water" ? (
                <View style={[styles.pointsRow, { marginBottom: 12 }]}>
                  <Text style={styles.pointsLabel}>Points:</Text>
                  <TextInput
                    style={styles.pointsInput}
                    keyboardType="number-pad"
                    value={waterPoints}
                    onChangeText={setWaterPoints}
                    onBlur={() => { setWaterPoints(clampPoints(waterPoints)); setEditingPoints(null); }}
                    autoFocus
                    maxLength={2}
                  />
                  <Text style={styles.pointsRange}>(1–50)</Text>
                </View>
              ) : (
                <TouchableOpacity style={[styles.editPointsBtn, { marginBottom: 12 }]} onPress={() => setEditingPoints("water")}>
                  <Text style={styles.editPointsText}>Edit points (+{waterPoints} pts)</Text>
                </TouchableOpacity>
              )
            )}
          </View>

        </View>

        <View style={styles.scoreInfo}>
          <Text style={styles.scoreInfoTitle}>Scoring</Text>
          <Text style={styles.scoreInfoText}>
            Days 1–2: 1x · Days 3–4: 1.25x · Days 5–6: 1.5x · Day 7+: 2x streak multiplier
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#0A0A0A" },
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
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9CA3AF",
    textTransform: "uppercase",
    letterSpacing: 0.08 * 11,
  },
  proNote: { fontSize: 11, color: "#6B7280" },
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
  segmented: {
    flexDirection: "row",
    backgroundColor: "#1F2937",
    borderRadius: 10,
    padding: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  segmentActive: { backgroundColor: "#374151" },
  segmentInner: { flexDirection: "row", alignItems: "center" },
  segmentText: { fontSize: 14, fontWeight: "600", color: "#9CA3AF" },
  segmentTextActive: { color: "#FFFFFF" },
  windowHint: { fontSize: 12, color: "#6B7280", marginTop: -4 },
  card: {
    backgroundColor: "#111827",
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1F2937",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1F2937",
  },
  toggleInfo: { flex: 1, gap: 1 },
  toggleLabel: { fontSize: 15, fontWeight: "600", color: "#FFFFFF" },
  toggleDesc: { fontSize: 12, color: "#9CA3AF" },
  inlineInput: {
    marginHorizontal: 16,
    marginBottom: 8,
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#374151",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#FFFFFF",
    backgroundColor: "#0A0A0A",
  },
  inputLocked: { color: "#6B7280", opacity: 0.6 },
  lastInline: { marginBottom: 12 },
  activityDivider: {
    height: 0.5,
    backgroundColor: "#374151",
    marginVertical: 8,
  },
  workoutInfo: {
    marginHorizontal: 16,
    marginBottom: 8,
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#374151",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#0A0A0A",
  },
  workoutInfoText: { fontSize: 13, color: "#6B7280" },
  editPointsBtn: {
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 4,
  },
  editPointsText: { fontSize: 12, color: colors.accent },
  pointsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 8,
    marginTop: 4,
    gap: 8,
  },
  pointsLabel: { fontSize: 13, color: "#9CA3AF" },
  pointsInput: {
    width: 52,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    fontSize: 14,
    color: "#FFFFFF",
    backgroundColor: "#0A0A0A",
    textAlign: "center",
  },
  pointsRange: { fontSize: 11, color: "#6B7280" },
  upgradeHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 4,
  },
  upgradeHintText: { fontSize: 12, color: "#6B7280" },
  scoreInfo: {
    backgroundColor: "#111827",
    borderRadius: 12,
    padding: 14,
    gap: 4,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
  },
  scoreInfoTitle: { fontSize: 13, fontWeight: "700", color: "#9CA3AF" },
  scoreInfoText: { fontSize: 13, color: "#9CA3AF", lineHeight: 18 },
});
