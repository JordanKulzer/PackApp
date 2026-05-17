import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { initNotifications } from "../../src/lib/notifications";
import { onboarding } from "../../src/constants/strings";

const C = {
  bg: "#0B0F14",
  surface: "#121821",
  surfaceRaised: "#1C2333",
  border: "#30363D",
  textPrimary: "#E6EDF3",
  textSecondary: "#8B949E",
  textTertiary: "#484F58",
  accent: "#2F81F7",
} as const;

const ROWS: {
  iconName: React.ComponentProps<typeof Ionicons>["name"];
  labelKey: "movementLabel" | "streakLabel" | "chatLabel";
  descKey: "movementDesc" | "streakDesc" | "chatDesc";
}[] = [
  {
    iconName: "trophy-outline",
    labelKey: "movementLabel",
    descKey: "movementDesc",
  },
  {
    iconName: "flame-outline",
    labelKey: "streakLabel",
    descKey: "streakDesc",
  },
  {
    iconName: "chatbubble-outline",
    labelKey: "chatLabel",
    descKey: "chatDesc",
  },
];

export default function NotificationsPrimer() {
  const router = useRouter();
  const [requesting, setRequesting] = useState(false);

  const goNext = () => {
    router.push("/(onboarding)/first-pack");
  };

  const handleEnable = async () => {
    if (requesting) return;
    setRequesting(true);
    try {
      await initNotifications();
    } catch {
      // User denied or system error — proceed regardless. The OS dialog has
      // resolved; the rest of the funnel shouldn't block on permission state.
    } finally {
      setRequesting(false);
      goNext();
    }
  };

  const handleSkip = () => {
    if (requesting) return;
    goNext();
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <TouchableOpacity
          style={s.skipBtn}
          onPress={handleSkip}
          hitSlop={12}
          disabled={requesting}
        >
          <Text style={s.skipText}>{onboarding.notifications.skip}</Text>
        </TouchableOpacity>

        <Text style={s.header}>{onboarding.notifications.headline}</Text>
        <Text style={s.subtitle}>{onboarding.notifications.subhead}</Text>

        <View style={s.group}>
          {ROWS.map((row, idx) => (
            <View key={row.labelKey}>
              <View style={s.row}>
                <View style={s.iconSlot}>
                  <Ionicons
                    name={row.iconName}
                    size={22}
                    color={C.textSecondary}
                  />
                </View>
                <View style={s.rowInfo}>
                  <Text style={s.rowLabel}>
                    {onboarding.notifications.rows[row.labelKey]}
                  </Text>
                  <Text style={s.rowDesc}>
                    {onboarding.notifications.rows[row.descKey]}
                  </Text>
                </View>
              </View>
              {idx < ROWS.length - 1 ? <View style={s.divider} /> : null}
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={s.primaryBtn}
          onPress={handleEnable}
          activeOpacity={0.85}
          disabled={requesting}
        >
          {requesting ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={s.primaryBtnText}>{onboarding.notifications.cta}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={handleSkip} hitSlop={8} style={s.skipLink}>
          <Text style={s.skipLinkText}>
            {onboarding.notifications.skipForNow}
          </Text>
        </TouchableOpacity>
        <Text style={s.skipHint}>{onboarding.notifications.skipHint}</Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: C.bg,
  },
  container: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 16,
    paddingBottom: 40,
    justifyContent: "center",
  },
  skipBtn: {
    position: "absolute",
    top: 16,
    right: 28,
  },
  skipText: {
    fontSize: 14,
    color: C.textTertiary,
  },
  header: {
    fontSize: 28,
    fontWeight: "700",
    color: C.textPrimary,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 15,
    color: C.textSecondary,
    lineHeight: 22,
    marginBottom: 32,
  },
  group: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: C.border,
    marginBottom: 32,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 14,
  },
  iconSlot: {
    width: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  rowInfo: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: C.textPrimary,
  },
  rowDesc: {
    fontSize: 12,
    color: C.textTertiary,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.border,
    marginLeft: 54,
  },
  primaryBtn: {
    height: 52,
    backgroundColor: C.accent,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFF",
  },
  skipLink: {
    alignItems: "center",
  },
  skipLinkText: {
    fontSize: 14,
    color: C.textTertiary,
  },
  skipHint: {
    fontSize: 12,
    color: C.textTertiary,
    textAlign: "center",
    marginTop: 6,
  },
});
