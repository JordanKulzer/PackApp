import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuthStore } from "../../src/stores/authStore";
import { useCurrentUser } from "../../src/context/CurrentUserContext";
import { supabase } from "../../src/lib/supabase";
import { CategoryChip } from "../../src/components/CategoryChip";
import {
  ACTIVITY_CATEGORIES,
  CATEGORY_DISPLAY_NAMES,
  DEFAULT_QUICK_SELECT,
  type ActivityCategory,
} from "../../src/lib/activityCategoryMap";
import { onboarding, t } from "../../src/constants/strings";

// Stable index lookup — used to sort the user's picks into platform display
// order at save time (regardless of tap order).
const CATEGORY_INDEX: Record<ActivityCategory, number> = ACTIVITY_CATEGORIES
  .reduce((acc, cat, i) => {
    acc[cat] = i;
    return acc;
  }, {} as Record<ActivityCategory, number>);

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

const MAX_PICKS = 6;

export default function CategorySelection() {
  const router = useRouter();
  const authUser = useAuthStore((s) => s.user);
  const { applyLocal } = useCurrentUser();

  // Selection order matters: first tapped is leftmost in the resulting grid.
  const [selected, setSelected] = useState<ActivityCategory[]>([]);
  const [saving, setSaving] = useState(false);

  const toggle = (cat: ActivityCategory) => {
    setSelected((prev) => {
      if (prev.includes(cat)) return prev.filter((c) => c !== cat);
      if (prev.length >= MAX_PICKS) return prev;
      return [...prev, cat];
    });
  };

  // Sort picks into platform display order (ACTIVITY_CATEGORIES) before save
  // so the resulting Quick Select grid reads consistently regardless of tap
  // order. Defaults are already in platform order.
  const persistAndContinue = async (
    next: readonly ActivityCategory[],
    sort = false,
  ) => {
    if (!authUser?.id || saving) return;
    setSaving(true);
    const ordered = sort
      ? [...next].sort((a, b) => CATEGORY_INDEX[a] - CATEGORY_INDEX[b])
      : [...next];
    try {
      const { error } = await supabase
        .from("users")
        .update({ quick_select_categories: ordered })
        .eq("id", authUser.id);
      if (error) {
        console.error("[CategorySelection] save error:", error);
      }
      applyLocal({ quickSelectCategories: ordered });
    } finally {
      setSaving(false);
      router.push("/(onboarding)/integrations");
    }
  };

  const handleSkip = () => persistAndContinue(DEFAULT_QUICK_SELECT);
  const handleContinue = () => persistAndContinue(selected, true);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <View style={s.headerWrap}>
          <Text style={s.header}>{onboarding.categorySelection.headline}</Text>
          <Text style={s.subtitle}>{onboarding.categorySelection.subhead}</Text>
        </View>

        <ScrollView
          contentContainerStyle={s.gridScroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={s.grid}>
            {ACTIVITY_CATEGORIES.map((cat) => (
              <CategoryChip
                key={cat}
                label={CATEGORY_DISPLAY_NAMES[cat]}
                pressed={selected.includes(cat)}
                onPress={() => toggle(cat)}
                disabled={
                  !selected.includes(cat) && selected.length >= MAX_PICKS
                }
              />
            ))}
          </View>
          <View style={s.counterRow}>
            {selected.length === MAX_PICKS && (
              <Ionicons
                name="checkmark-circle"
                size={14}
                color="#34C759"
                style={s.counterIcon}
              />
            )}
            <Text
              style={[
                s.counter,
                selected.length === MAX_PICKS && s.counterAtCap,
              ]}
            >
              {t(onboarding.categorySelection.counter, {
                count: selected.length,
                max: MAX_PICKS,
              })}
            </Text>
          </View>
        </ScrollView>

        <View style={s.footer}>
          <TouchableOpacity
            onPress={handleSkip}
            disabled={saving}
            hitSlop={12}
          >
            <Text style={s.skipText}>{onboarding.categorySelection.skip}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              s.continueBtn,
              (saving || selected.length === 0) && s.continueBtnDisabled,
            ]}
            onPress={handleContinue}
            disabled={saving || selected.length === 0}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={s.continueText}>{onboarding.categorySelection.cta}</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 24,
  },
  headerWrap: {
    marginBottom: 24,
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
  },
  gridScroll: {
    paddingBottom: 24,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  counterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
    gap: 4,
  },
  counterIcon: {
    marginTop: -1, // optical alignment with text baseline
  },
  counter: {
    fontSize: 13,
    color: C.textTertiary,
    textAlign: "center",
  },
  counterAtCap: {
    color: "#34C759",
    fontWeight: "600",
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
    gap: 16,
  },
  skipText: {
    fontSize: 15,
    color: C.textTertiary,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  continueBtn: {
    flex: 1,
    height: 52,
    backgroundColor: C.accent,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  continueBtnDisabled: {
    opacity: 0.5,
  },
  continueText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFF",
  },
});
