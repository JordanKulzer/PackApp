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
import { useCurrentUser } from "../../src/context/CurrentUserContext";
import { supabase } from "../../src/lib/supabase";
import { ensureUserProfile } from "../../src/lib/ensureUserProfile";
import { seedDailyScoresOnJoin } from "../../src/lib/joinPack";
import { analytics } from "../../src/lib/analytics";
import { notifyPackMembers } from "../../src/lib/notifications";
import { fallbacks } from "../../src/constants/strings";
import { FREE_PACK_LIMIT, FREE_MEMBER_LIMIT } from "../../src/lib/revenuecat";
import type { Pack } from "../../src/types/database";
import { BrandColors } from "../../src/constants/brand";

type JoinStatus = "loading" | "found" | "joining" | "joined" | "error";

export default function JoinPack() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { user: currentUser } = useCurrentUser();
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
        `Free accounts can join up to ${FREE_PACK_LIMIT} packs. Pro upgrade coming soon!`
      );
      return;
    }

    // Check pack member limit for free packs
    if (memberCount >= FREE_MEMBER_LIMIT) {
      setStatus("found");
      Alert.alert(
        "Pack is full",
        `This pack has reached its maximum of ${FREE_MEMBER_LIMIT} members. Larger pack sizes coming with Pro!`
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

    // F.2 Bug 8: seed daily_scores so the new member shows on the
    // leaderboard immediately, matching JoinPackModal behavior. Pre-F.2
    // the deep-link path skipped this step entirely — users joining
    // via invite link were invisible until their first activity logged.
    const { data: activeRun } = await supabase
      .from("runs")
      .select("id")
      .eq("pack_id", pack.id)
      .eq("status", "active")
      .maybeSingle();

    if (activeRun) {
      await seedDailyScoresOnJoin(user.id, pack, activeRun.id);
    }

    // Pass 9 funnel — pack_joined via deep link. userPackCount was queried
    // pre-insert above; post-insert state is userPackCount + 1.
    analytics.packJoined({
      is_first_join: (userPackCount ?? 0) === 0,
      pack_member_count_at_join: memberCount + 1,
      current_pack_count: (userPackCount ?? 0) + 1,
      join_source: "deep_link",
    });

    // Pass 7c — broadcast new_member push to existing packmates. Server-side
    // copy via push.newMemberJoined from _shared/push-strings.ts. Fallback
    // covers brand-new-social-signup race where useCurrentUser hasn't
    // hydrated yet (ensureUserProfile above ensures the row exists).
    const newMemberName =
      currentUser?.displayName?.trim() || fallbacks.newMemberName;
    notifyPackMembers(user.id, pack.id, {
      kind: "new_member",
      newMemberName,
      packName: pack.name,
    }).catch(() => {});

    setStatus("joined");
    setTimeout(() => {
      router.replace(`/(app)/pack/${pack.id}`);
    }, 1500);
  };

  if (status === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={BrandColors.blue} />
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
        <ActivityIndicator color={BrandColors.blue} style={{ marginTop: 16 }} />
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
          <Text style={styles.buttonText}>Join pack</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BrandColors.background,
    padding: 24,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
    backgroundColor: BrandColors.background,
  },
  header: {
    paddingTop: 40,
    marginBottom: 32,
  },
  cancelText: {
    fontSize: 16,
    color: BrandColors.inkMuted,
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
    color: BrandColors.ink,
    textAlign: "center",
    letterSpacing: -0.5,
  },
  packMeta: {
    fontSize: 15,
    color: BrandColors.inkMuted,
  },
  activities: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
    marginTop: 8,
  },
  actTag: {
    backgroundColor: BrandColors.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 5,
    fontSize: 13,
    fontWeight: "600",
    color: BrandColors.blueSoft,
    borderWidth: 1,
    borderColor: "#30363D",
  },
  button: {
    height: 56,
    backgroundColor: BrandColors.blue,
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
    color: BrandColors.inkMuted,
    marginTop: 12,
  },
  errorEmoji: { fontSize: 52 },
  errorTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: BrandColors.ink,
  },
  errorMessage: {
    fontSize: 15,
    color: BrandColors.inkMuted,
    textAlign: "center",
    lineHeight: 22,
  },
  successEmoji: { fontSize: 64 },
  successTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: BrandColors.ink,
  },
  successSubtitle: {
    fontSize: 16,
    color: BrandColors.inkMuted,
  },
});
