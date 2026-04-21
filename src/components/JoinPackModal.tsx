import { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useAuthStore } from "../stores/authStore";
import { supabase } from "../lib/supabase";
import { ensureUserProfile } from "../lib/ensureUserProfile";
import { colors } from "../theme/colors";

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

export interface JoinPackModalProps {
  visible: boolean;
  onClose: () => void;
  onJoined: (packId: string, packName: string) => void;
}

export function JoinPackModal({ visible, onClose, onJoined }: JoinPackModalProps) {
  const user = useAuthStore((s) => s.user);
  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setCode("");
      setError(null);
      setIsLoading(false);
    }
  }, [visible]);

  const handleJoin = async () => {
    if (!code.trim()) {
      setError("Please enter an invite code.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const userId = user?.id;
      if (!userId) throw new Error("Not authenticated");

      const normalizedCode = code.trim().toUpperCase();
      console.log("[JoinPackModal] Attempting join with code:", normalizedCode);

      // Step 1: Find pack by invite code
      const { data: pack, error: packError } = await supabase
        .from("packs")
        .select("id, name, is_active")
        .eq("invite_code", normalizedCode)
        .single();

      console.log("[JoinPackModal] Pack lookup result:", {
        pack,
        packError: packError
          ? { message: packError.message, code: packError.code, details: packError.details, hint: packError.hint }
          : null,
      });

      if (packError || !pack) {
        setError("Invalid invite code. Please check and try again.");
        return;
      }

      if (!pack.is_active) {
        setError("This pack is no longer active.");
        return;
      }

      // Step 2: Check if user is already a member
      const { data: existingMember, error: existingError } = await supabase
        .from("pack_members")
        .select("id")
        .eq("pack_id", pack.id)
        .eq("user_id", userId)
        .maybeSingle();

      console.log("[JoinPackModal] Existing member check:", { existingMember, existingError });

      if (existingMember) {
        setError("You are already in this pack.");
        return;
      }

      // Step 3: Check member count against limit
      const { count, error: countError } = await supabase
        .from("pack_members")
        .select("id", { count: "exact", head: true })
        .eq("pack_id", pack.id)
        .eq("is_active", true);

      console.log("[JoinPackModal] Member count:", { count, countError });

      // Step 4: Guarantee users row exists before inserting pack membership
      await ensureUserProfile(userId, user);

      // Step 5: Insert pack_member row
      const { error: joinError } = await supabase.from("pack_members").insert({
        pack_id: pack.id,
        user_id: userId,
        role: "member",
        is_active: true,
        joined_at: new Date().toISOString(),
      });

      console.log("[JoinPackModal] Insert member result:", { joinError });

      if (joinError) throw joinError;

      // Step 6: Create initial daily_scores row so the new member appears immediately
      const { data: activeRun, error: runError } = await supabase
        .from("runs")
        .select("id")
        .eq("pack_id", pack.id)
        .eq("status", "active")
        .maybeSingle();

      console.log("[JoinPackModal] Active run:", { activeRun, runError });

      if (activeRun) {
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

        const { error: scoreError } = await supabase.from("daily_scores").upsert(
          {
            run_id: activeRun.id,
            user_id: userId,
            score_date: today,
            total_points: 0,
            streak_days: 0,
            streak_multiplier: 1.0,
            steps_achieved: false,
            workout_achieved: false,
            calories_achieved: false,
            water_achieved: false,
            steps_count: 0,
            calories_count: 0,
            water_oz_count: 0,
            workout_count: 0,
          },
          { onConflict: "run_id,user_id,score_date" },
        );

        console.log("[JoinPackModal] Initial daily_scores upsert:", { scoreError });
      }

      // Step 7: Success
      console.log("[JoinPackModal] Join successful:", pack.id, pack.name);
      onJoined(pack.id, pack.name);
    } catch (err) {
      console.error("[JoinPackModal] Unexpected error:", err);
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={s.overlay}>
        <View style={s.card}>
          <Text style={s.title}>Join a Pack</Text>
          <Text style={s.subtitle}>
            Enter the invite code shared by your friend
          </Text>

          <TextInput
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase().trim())}
            placeholder="e.g. HC2MQY"
            placeholderTextColor={C.textTertiary}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
            style={s.input}
          />

          {error ? <Text style={s.error}>{error}</Text> : null}

          <View style={s.buttonRow}>
            <TouchableOpacity
              style={s.cancelBtn}
              onPress={onClose}
              disabled={isLoading}
              activeOpacity={0.7}
            >
              <Text style={s.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.joinBtn, isLoading && s.btnDisabled]}
              onPress={handleJoin}
              disabled={isLoading}
              activeOpacity={0.8}
            >
              {isLoading ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={s.joinBtnText}>Join Pack</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
  },
  card: {
    backgroundColor: C.surface,
    borderRadius: 20,
    marginHorizontal: 24,
    padding: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: C.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    color: C.textSecondary,
    marginTop: 4,
  },
  input: {
    backgroundColor: C.surfaceRaised,
    borderWidth: 0.5,
    borderColor: C.border,
    borderRadius: 12,
    padding: 14,
    fontSize: 24,
    fontWeight: "700",
    color: C.textPrimary,
    textAlign: "center",
    letterSpacing: 4,
    marginTop: 20,
  },
  error: {
    color: C.danger,
    fontSize: 13,
    marginTop: 8,
    textAlign: "center",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 16,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: C.surfaceRaised,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: C.textSecondary,
  },
  joinBtn: {
    flex: 1,
    backgroundColor: C.accent,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  joinBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  btnDisabled: {
    opacity: 0.6,
  },
});
