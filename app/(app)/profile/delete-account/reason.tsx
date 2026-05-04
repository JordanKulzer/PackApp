// Pass 10a — Reason picker + final destructive action.
//
// Five preset reasons + Other (text input, max 200 chars) + Skip. After
// selection the user taps "Delete forever" which surfaces a final native
// modal confirmation, then runs the deletion sequence.
//
// Reason labels are placeholder per Pass 10a scope. Pass 10b voice-reviews
// the copy. Order and shape of options is final per the user's spec.
import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  Alert,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { deleteAccount } from "../../../../src/lib/accountDeletion";

const C = {
  bg: "#0B0F14",
  surface: "#121821",
  surfaceRaised: "#1C2333",
  border: "#30363D",
  textPrimary: "#E6EDF3",
  textSecondary: "#8B949E",
  textTertiary: "#484F58",
  destructive: "#F85149",
  accent: "#2F81F7",
} as const;

const PRESET_REASONS: { id: string; label: string }[] = [
  { id: "not_using",     label: "Not using it enough" },
  { id: "no_friends",    label: "Friends won't join" },
  { id: "too_expensive", label: "Too expensive / paywall hit" },
  { id: "privacy",       label: "Privacy concerns" },
  { id: "found_better",  label: "Found a better app" },
  { id: "other",         label: "Other" },
];

const OTHER_MAX_CHARS = 200;

export default function DeleteAccountReason() {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [otherText, setOtherText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const isOther = selectedId === "other";
  const canSubmit =
    selectedId !== null && (!isOther || otherText.trim().length > 0);

  // Resolve the reason value sent to the server. Skip = null. Preset = id.
  // Other = trimmed user-supplied text (truncated to 200 chars defensively).
  const buildReasonValue = (skip: boolean): string | null => {
    if (skip) return null;
    if (selectedId === null) return null;
    if (selectedId === "other") {
      const trimmed = otherText.trim();
      if (trimmed.length === 0) return null;
      return trimmed.slice(0, OTHER_MAX_CHARS);
    }
    return selectedId;
  };

  const runDeletion = async (skipReason: boolean) => {
    if (isDeleting) return;
    setIsDeleting(true);

    const reason = buildReasonValue(skipReason);
    const result = await deleteAccount({ reason });

    if (result.ok) {
      // Edge Function succeeded + local cleanup ran. Navigate to sign-in.
      // The signOut inside deleteAccount already cleared the session, so
      // the auth-state listener in _layout.tsx may already be redirecting;
      // the router.replace below is a belt-and-suspenders.
      router.replace("/(auth)/sign-in");
      return;
    }

    setIsDeleting(false);

    // Surface a friendly message. The user remains signed in (server may
    // also still have their data depending on which step failed). They
    // can retry from this screen — DON'T re-fire account_deleted on retry,
    // which is handled inside deleteAccount (no event re-fire path exists).
    const message =
      result.errorKind === "timeout"
        ? "Deletion is taking longer than expected. Your data is being removed — try again in a few minutes."
        : result.error ?? "Couldn't delete your account. Try again or contact support.";

    Alert.alert("Couldn't delete account", message, [{ text: "OK" }]);
  };

  const handleDeletePress = () => {
    if (!canSubmit || isDeleting) return;
    Alert.alert(
      "Delete forever?",
      "This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => runDeletion(false),
        },
      ],
      { cancelable: true },
    );
  };

  const handleSkipPress = () => {
    if (isDeleting) return;
    Alert.alert(
      "Delete forever?",
      "This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => runDeletion(true),
        },
      ],
      { cancelable: true },
    );
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={s.container}
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.headerRow}>
            <TouchableOpacity onPress={() => router.back()} hitSlop={12} disabled={isDeleting}>
              <Ionicons
                name="chevron-back"
                size={28}
                color={isDeleting ? C.textTertiary : C.textPrimary}
              />
            </TouchableOpacity>
            <Text style={s.headerTitle}>Reason</Text>
            <TouchableOpacity onPress={handleSkipPress} hitSlop={12} disabled={isDeleting}>
              <Text style={[s.skipText, isDeleting && s.disabled]}>Skip</Text>
            </TouchableOpacity>
          </View>

          <Text style={s.headline}>Why are you leaving?</Text>
          <Text style={s.subhead}>
            This helps us improve. You can skip if you'd rather not say.
          </Text>

          <View style={s.options}>
            {PRESET_REASONS.map((opt) => {
              const selected = selectedId === opt.id;
              return (
                <TouchableOpacity
                  key={opt.id}
                  style={[s.option, selected && s.optionSelected]}
                  onPress={() => setSelectedId(opt.id)}
                  disabled={isDeleting}
                  activeOpacity={0.85}
                >
                  <View style={[s.radio, selected && s.radioSelected]}>
                    {selected && <View style={s.radioDot} />}
                  </View>
                  <Text style={s.optionLabel}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {isOther && (
            <View style={s.otherBox}>
              <TextInput
                style={s.otherInput}
                placeholder="Tell us more (optional)"
                placeholderTextColor={C.textTertiary}
                value={otherText}
                onChangeText={(t) => setOtherText(t.slice(0, OTHER_MAX_CHARS))}
                multiline
                editable={!isDeleting}
                maxLength={OTHER_MAX_CHARS}
              />
              <Text style={s.otherCounter}>
                {otherText.length}/{OTHER_MAX_CHARS}
              </Text>
            </View>
          )}

          <View style={s.buttons}>
            <TouchableOpacity
              style={[s.deleteBtn, (!canSubmit || isDeleting) && s.btnDisabled]}
              onPress={handleDeletePress}
              disabled={!canSubmit || isDeleting}
              activeOpacity={0.85}
            >
              {isDeleting ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={s.deleteBtnText}>Delete forever</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  flex: { flex: 1 },
  container: { flex: 1 },
  content: { padding: 24, paddingBottom: 48 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: C.textPrimary,
  },
  skipText: {
    fontSize: 15,
    fontWeight: "500",
    color: C.accent,
  },
  disabled: { opacity: 0.4 },
  headline: {
    fontSize: 26,
    fontWeight: "700",
    color: C.textPrimary,
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  subhead: {
    fontSize: 15,
    color: C.textSecondary,
    marginBottom: 24,
  },
  options: {
    gap: 8,
    marginBottom: 16,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  optionSelected: {
    borderColor: C.accent,
    backgroundColor: C.surfaceRaised,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: { borderColor: C.accent },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: C.accent,
  },
  optionLabel: {
    flex: 1,
    fontSize: 15,
    color: C.textPrimary,
  },
  otherBox: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 24,
  },
  otherInput: {
    minHeight: 80,
    color: C.textPrimary,
    fontSize: 15,
    textAlignVertical: "top",
  },
  otherCounter: {
    fontSize: 12,
    color: C.textTertiary,
    textAlign: "right",
    marginTop: 4,
  },
  buttons: { gap: 12, marginTop: 16 },
  deleteBtn: {
    height: 52,
    backgroundColor: C.destructive,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFF",
  },
  btnDisabled: { opacity: 0.4 },
});
