import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuthStore } from "../../src/stores/authStore";
import { supabase } from "../../src/lib/supabase";
import { ensureUserProfile } from "../../src/lib/ensureUserProfile";
import { FREE_PACK_LIMIT, FREE_MEMBER_LIMIT } from "../../src/lib/revenuecat";
import type { Pack } from "../../src/types/database";

type JoinStatus = "loading" | "found" | "joining" | "joined" | "error";

export default function JoinPack() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [status, setStatus] = useState<JoinStatus>("loading");
  const [pack, setPack] = useState<Pack | null>(null);
  const [memberCount, setMemberCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!code) return;
    lookupPack(code.toUpperCase());
  }, [code]);

  const lookupPack = async (inviteCode: string) => {
    setStatus("loading");
    const { data, error } = await supabase
      .from("packs")
      .select("*")
      .eq("invite_code", inviteCode)
      .eq("is_active", true)
      .single();

    if (error || !data) {
      setErrorMessage("This invite code is invalid or the pack no longer exists.");
      setStatus("error");
      return;
    }

    const { count } = await supabase
      .from("pack_members")
      .select("*", { count: "exact", head: true })
      .eq("pack_id", data.id)
      .eq("is_active", true);

    setPack(data);
    setMemberCount(count ?? 0);
    setStatus("found");
  };

  const handleJoin = async () => {
    if (!user || !pack) return;
    setStatus("joining");

    // Check if already a member
    const { data: existing } = await supabase
      .from("pack_members")
      .select("id")
      .eq("pack_id", pack.id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existing) {
      router.replace(`/(app)/pack/${pack.id}`);
      return;
    }

    // Check free tier pack limit
    const { count: userPackCount } = await supabase
      .from("pack_members")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("is_active", true);

    const { data: userData } = await supabase
      .from("users")
      .select("subscription_tier")
      .eq("id", user.id)
      .single();

    const tier = userData?.subscription_tier ?? "free";

    if (tier === "free" && (userPackCount ?? 0) >= FREE_PACK_LIMIT) {
      setStatus("found");
      Alert.alert(
        "Pack limit reached",
        `Free accounts can join up to ${FREE_PACK_LIMIT} packs. Upgrade to Pro for unlimited packs.`
      );
      return;
    }

    // Check pack member limit for free packs
    if (memberCount >= FREE_MEMBER_LIMIT) {
      setStatus("found");
      Alert.alert(
        "Pack is full",
        `This pack has reached the maximum of ${FREE_MEMBER_LIMIT} members.`
      );
      return;
    }

    await ensureUserProfile(user.id, user);

    const { error } = await supabase.from("pack_members").insert({
      pack_id: pack.id,
      user_id: user.id,
      role: "member",
      is_active: true,
    });

    if (error) {
      setErrorMessage(error.message);
      setStatus("error");
      return;
    }

    setStatus("joined");
    setTimeout(() => {
      router.replace(`/(app)/pack/${pack.id}`);
    }, 1500);
  };

  if (status === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#6366F1" />
        <Text style={styles.loadingText}>Looking up invite code…</Text>
      </View>
    );
  }

  if (status === "error") {
    return (
      <View style={styles.center}>
        <Text style={styles.errorEmoji}>😕</Text>
        <Text style={styles.errorTitle}>Invalid Invite</Text>
        <Text style={styles.errorMessage}>{errorMessage}</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.replace("/(app)/home")}
        >
          <Text style={styles.buttonText}>Go Home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (status === "joined") {
    return (
      <View style={styles.center}>
        <Text style={styles.successEmoji}>🎉</Text>
        <Text style={styles.successTitle}>You joined the pack!</Text>
        <Text style={styles.successSubtitle}>Opening {pack?.name}…</Text>
        <ActivityIndicator color="#6366F1" style={{ marginTop: 16 }} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.packPreview}>
        <Text style={styles.packEmoji}>🐺</Text>
        <Text style={styles.packName}>{pack?.name}</Text>
        <Text style={styles.packMeta}>
          {memberCount} member{memberCount !== 1 ? "s" : ""} ·{" "}
          {pack?.competition_window === "weekly" ? "Weekly" : "Monthly"} competition
        </Text>

        <View style={styles.activities}>
          {pack?.steps_enabled && <Text style={styles.actTag}>👟 Steps</Text>}
          {pack?.workouts_enabled && <Text style={styles.actTag}>💪 Workouts</Text>}
          {pack?.calories_enabled && <Text style={styles.actTag}>🔥 Calories</Text>}
          {pack?.water_enabled && <Text style={styles.actTag}>💧 Water</Text>}
        </View>
      </View>

      <TouchableOpacity
        style={[styles.button, status === "joining" && styles.buttonDisabled]}
        onPress={handleJoin}
        disabled={status === "joining"}
        activeOpacity={0.85}
      >
        {status === "joining" ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={styles.buttonText}>Join Pack</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F9FAFB",
    padding: 24,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
  },
  header: {
    paddingTop: 40,
    marginBottom: 32,
  },
  cancelText: {
    fontSize: 16,
    color: "#6B7280",
  },
  packPreview: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  packEmoji: { fontSize: 72 },
  packName: {
    fontSize: 28,
    fontWeight: "800",
    color: "#111827",
    textAlign: "center",
    letterSpacing: -0.5,
  },
  packMeta: {
    fontSize: 15,
    color: "#9CA3AF",
  },
  activities: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
    marginTop: 8,
  },
  actTag: {
    backgroundColor: "#EEF2FF",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 5,
    fontSize: 13,
    fontWeight: "600",
    color: "#4F46E5",
  },
  button: {
    height: 56,
    backgroundColor: "#6366F1",
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 32,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: {
    color: "#FFF",
    fontSize: 17,
    fontWeight: "700",
  },
  loadingText: {
    fontSize: 15,
    color: "#9CA3AF",
    marginTop: 12,
  },
  errorEmoji: { fontSize: 52 },
  errorTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#111827",
  },
  errorMessage: {
    fontSize: 15,
    color: "#9CA3AF",
    textAlign: "center",
    lineHeight: 22,
  },
  successEmoji: { fontSize: 64 },
  successTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#111827",
  },
  successSubtitle: {
    fontSize: 16,
    color: "#9CA3AF",
  },
});
