// Pass 10a — Account deletion confirmation screen.
//
// First step of the destructive flow. Explains what deletion does and
// surfaces the App Store subscription caveat (Pack cannot cancel App Store
// billing — user must cancel separately in iOS Settings).
//
// Copy is PLACEHOLDER. Pass 10b will replace these strings with voice-
// reviewed copy. Plain language wins for legal-sensitive moments anyway,
// so the placeholder copy is functional even if not on-brand.
import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  SafeAreaView,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { BrandColors } from "../../../../src/constants/brand";

const C = {
  bg: "#0B0F14",
  surface: "#121821",
  border: "#30363D",
  textPrimary: "#E6EDF3",
  textSecondary: "#8B949E",
  textTertiary: "#484F58",
  destructive: "#F85149",
} as const;

export default function DeleteAccountConfirm() {
  const router = useRouter();
  const [acknowledged, setAcknowledged] = useState(false);

  const handleContinue = () => {
    router.push("/(app)/profile/delete-account/reason");
  };

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView style={s.container} contentContainerStyle={s.content}>
        <View style={s.headerRow}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={28} color={C.textPrimary} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Delete account</Text>
          <View style={{ width: 28 }} />
        </View>

        <Text style={s.headline}>Delete your account?</Text>
        <Text style={s.body}>
          This permanently deletes your account, your activity history, your
          photos, and your reactions and comments on packmates' activity.
          {"\n\n"}
          Packs you created will transfer to the next-oldest member. If you
          are the only member of a pack you created, that pack is deleted
          along with your account.
          {"\n\n"}
          This cannot be undone.
        </Text>

        <View style={s.warningBox}>
          <Ionicons
            name="warning-outline"
            size={20}
            color={C.destructive}
            style={s.warningIcon}
          />
          <Text style={s.warningText}>
            If you have an active Pack Pro subscription, deleting your account
            does not cancel it. To stop billing, open iOS Settings → [your
            name] → Subscriptions → Pack and cancel there.
          </Text>
        </View>

        <TouchableOpacity
          style={s.checkbox}
          activeOpacity={0.7}
          onPress={() => setAcknowledged((v) => !v)}
        >
          <View style={[s.checkboxBox, acknowledged && s.checkboxBoxChecked]}>
            {acknowledged && (
              <Ionicons name="checkmark" size={18} color="#FFF" />
            )}
          </View>
          <Text style={s.checkboxLabel}>
            I understand this is permanent and cannot be undone.
          </Text>
        </TouchableOpacity>

        <View style={s.buttons}>
          <TouchableOpacity
            style={[s.continueBtn, !acknowledged && s.btnDisabled]}
            onPress={handleContinue}
            disabled={!acknowledged}
            activeOpacity={0.85}
          >
            <Text style={s.continueBtnText}>Continue</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.cancelBtn}
            onPress={() => router.back()}
            activeOpacity={0.85}
          >
            <Text style={s.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
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
  headline: {
    fontSize: 28,
    fontWeight: "700",
    color: C.textPrimary,
    letterSpacing: -0.5,
    marginBottom: 16,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: C.textSecondary,
    marginBottom: 24,
  },
  warningBox: {
    flexDirection: "row",
    backgroundColor: "rgba(248, 81, 73, 0.10)",
    borderColor: "rgba(248, 81, 73, 0.30)",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 24,
    gap: 10,
  },
  warningIcon: { marginTop: 1 },
  warningText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: BrandColors.ink,
  },
  checkbox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 28,
  },
  checkboxBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxBoxChecked: {
    backgroundColor: C.destructive,
    borderColor: C.destructive,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 14,
    color: C.textPrimary,
  },
  buttons: { gap: 12 },
  continueBtn: {
    height: 52,
    backgroundColor: C.destructive,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  continueBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFF",
  },
  cancelBtn: {
    height: 52,
    backgroundColor: "transparent",
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: C.textPrimary,
  },
  btnDisabled: { opacity: 0.4 },
});
