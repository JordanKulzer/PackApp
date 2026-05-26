import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Linking,
  Platform,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  getOfferings,
  purchasePackage,
  restorePurchases,
  PRO_MONTHLY_PRICE,
  PRO_ANNUAL_PRICE,
} from "../src/lib/revenuecat";
import { analytics } from "../src/lib/analytics";
import { supabase } from "../src/lib/supabase";
import { useAuthStore } from "../src/stores/authStore";
import { colors } from "../src/theme/colors";
import type { PurchasesPackage } from "react-native-purchases";

const C = {
  bg: "#0B0F14",
  surface: "#121821",
  surfaceRaised: "#1C2333",
  border: "#30363D",
  textPrimary: "#E6EDF3",
  textSecondary: "#8B949E",
  textTertiary: "#484F58",
  accent: colors.self,
  gold: "#F5A623",
  success: "#3FB950",
  muted: "#374151",
} as const;

const FEATURES = [
  { icon: "infinite-outline", text: "Unlimited packs" },
  { icon: "people-outline", text: "Up to 25 members per pack" },
  { icon: "calendar-outline", text: "Weekly & monthly competition windows" },
  { icon: "bar-chart-outline", text: "Full pack history" },
];

// Roadmap — planned but not yet built. Rendered in a visually-distinct
// "Coming Soon" section so TestFlight testers don't mistake them for
// live features. Muted row treatment + accent "Soon" tag mirrors the
// integration rows in app/(app)/profile/index.tsx (Fitbit / Oura /
// Whoop) for app-wide consistency.
const COMING_SOON = [
  {
    icon: "trending-up-outline",
    label: "Trends",
    subtitle: "Progress charts and stats over time",
  },
  {
    icon: "ribbon-outline",
    label: "Badges",
    subtitle: "Earn achievement badges",
  },
  {
    icon: "color-palette-outline",
    label: "Cosmetics",
    subtitle: "Ring colors, profile effects, and more",
  },
];

export default function Paywall() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { trigger = "unknown" } = useLocalSearchParams<{ trigger: string }>();

  const [selectedPlan, setSelectedPlan] = useState<"annual" | "monthly">(
    "annual",
  );
  const [monthlyPkg, setMonthlyPkg] = useState<PurchasesPackage | null>(null);
  const [annualPkg, setAnnualPkg] = useState<PurchasesPackage | null>(null);
  const [isLoadingOfferings, setIsLoadingOfferings] = useState(true);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const userId = useAuthStore((s) => s.session?.user?.id);

  // Tracks the most recent paywall_viewed firing time so paywall_converted
  // can compute time_to_convert_sec. If the user dismisses and re-opens, the
  // remount resets this — most-recent-view wins, which is what we want.
  const paywallViewedAtRef = useRef<number>(0);

  useEffect(() => {
    paywallViewedAtRef.current = Date.now();

    // Fire paywall_viewed with funnel context. Two cheap queries: the user's
    // active pack count and the largest pack's member count. Both are
    // best-effort — if they fail, fall back to 0 so the event still lands.
    (async () => {
      let currentPackCount = 0;
      let currentMemberCountInLargestPack = 0;
      if (userId) {
        const { data: memberships } = await supabase
          .from("pack_members")
          .select("pack_id")
          .eq("user_id", userId)
          .eq("is_active", true);
        currentPackCount = memberships?.length ?? 0;
        if (memberships && memberships.length > 0) {
          // Find largest pack by active-member count among those the user belongs to.
          const counts = await Promise.all(
            memberships.map((m) =>
              supabase
                .from("pack_members")
                .select("id", { count: "exact", head: true })
                .eq("pack_id", m.pack_id)
                .eq("is_active", true)
                .then((r) => r.count ?? 0),
            ),
          );
          currentMemberCountInLargestPack = Math.max(0, ...counts);
        }
      }
      analytics.paywallViewed({
        trigger: trigger as string,
        current_pack_count: currentPackCount,
        current_member_count_in_largest_pack: currentMemberCountInLargestPack,
      });
    })();

    getOfferings().then((offering) => {
      if (!offering) {
        setIsLoadingOfferings(false);
        return;
      }
      for (const pkg of offering.availablePackages) {
        const id = pkg.product.identifier;
        if (id === "pack_pro_monthly") setMonthlyPkg(pkg);
        if (id === "pack_pro_annual") setAnnualPkg(pkg);
      }
      setIsLoadingOfferings(false);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDismiss = useCallback(
    (method: "cancel" | "x" | "swipe" | "hardware_back" = "cancel") => {
      analytics.paywallDismissed(trigger as string, method);
      router.back();
    },
    [trigger, router],
  );

  const handlePurchase = async () => {
    const pkg = selectedPlan === "annual" ? annualPkg : monthlyPkg;
    if (!pkg) return;
    setIsPurchasing(true);
    setStatusMsg(null);
    try {
      const info = await purchasePackage(pkg);
      if (info) {
        const timeToConvertSec = paywallViewedAtRef.current
          ? Math.max(0, Math.round((Date.now() - paywallViewedAtRef.current) / 1000))
          : 0;
        analytics.paywallConverted({
          product_id: pkg.product.identifier,
          trigger_at_view: trigger as string,
          time_to_convert_sec: timeToConvertSec,
        });
        setStatusMsg("You're now Pro! Enjoy unlimited packs.");
        setTimeout(() => router.back(), 1500);
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Purchase failed. Please try again.";
      setStatusMsg(msg);
    } finally {
      setIsPurchasing(false);
    }
  };

  const handleRestore = async () => {
    setIsRestoring(true);
    setStatusMsg(null);
    try {
      const info = await restorePurchases();
      const hasPro = !!info.entitlements.active["pro"];
      if (hasPro) {
        analytics.proRestored();
        setStatusMsg("Purchase restored! You're now Pro.");
        setTimeout(() => router.back(), 1500);
      } else {
        setStatusMsg("No previous purchases found.");
      }
    } catch {
      setStatusMsg("Restore failed. Please try again.");
    } finally {
      setIsRestoring(false);
    }
  };

  const activePkg = selectedPlan === "annual" ? annualPkg : monthlyPkg;

  return (
    <View style={[s.container, { paddingTop: 20 }]}>
      {/* Dismiss header — Close (left) + X (right) */}
      <View style={s.dismissRow}>
        <TouchableOpacity
          style={s.cancelBtn}
          onPress={() => handleDismiss("cancel")}
          hitSlop={10}
        >
          <Text style={s.cancelText}>Close</Text>
        </TouchableOpacity>
        {/* <TouchableOpacity
          style={s.closeBtn}
          onPress={() => handleDismiss("x")}
          hitSlop={10}
        >
          <Ionicons name="close-circle" size={28} color={C.textSecondary} />
        </TouchableOpacity> */}
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={[
          s.content,
          { paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
        onScrollEndDrag={({ nativeEvent }) => {
          if (nativeEvent.contentOffset.y < -60) handleDismiss("swipe");
        }}
      >
        {/* Header */}
        <View style={s.header}>
          <View style={s.proBadge}>
            <Text style={s.proBadgeText}>PRO</Text>
          </View>
          <Text style={s.headline}>Unlock the full Pack experience</Text>
          <Text style={s.subheadline}>
            Everything you need to run a serious challenge.
          </Text>
        </View>

        {/* Feature list */}
        <View style={s.featureList}>
          {FEATURES.map((f) => (
            <View key={f.text} style={s.featureRow}>
              <Ionicons
                name={f.icon as "infinite-outline"}
                size={18}
                color={C.success}
              />
              <Text style={s.featureText}>{f.text}</Text>
            </View>
          ))}
        </View>

        {/* Coming Soon — roadmap, visually distinct from current perks so
            TestFlight testers don't mistake them for live features. */}
        <View style={s.comingSoonSection}>
          <Text style={s.comingSoonHeader}>COMING SOON</Text>
          <View style={s.comingSoonList}>
            {COMING_SOON.map((c) => (
              <View key={c.label} style={s.comingSoonRow}>
                <Ionicons
                  name={c.icon as "trending-up-outline"}
                  size={18}
                  color={C.textSecondary}
                />
                <View style={s.comingSoonTextCol}>
                  <Text style={s.comingSoonLabel}>{c.label}</Text>
                  <Text style={s.comingSoonSubtitle}>{c.subtitle}</Text>
                </View>
                <Text style={s.comingSoonTag}>Soon</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Plan selector */}
        {isLoadingOfferings ? (
          <ActivityIndicator color={C.accent} style={{ marginVertical: 24 }} />
        ) : (
          <View style={s.plans}>
            {/* Annual */}
            <TouchableOpacity
              style={[
                s.planCard,
                selectedPlan === "annual" && s.planCardActive,
              ]}
              onPress={() => setSelectedPlan("annual")}
              activeOpacity={0.8}
            >
              <View style={s.planCardTop}>
                <View style={s.planNameRow}>
                  <Text
                    style={[
                      s.planName,
                      selectedPlan === "annual" && s.planNameActive,
                    ]}
                  >
                    Annual
                  </Text>
                  <View style={s.saveBadge}>
                    <Text style={s.saveBadgeText}>Save 44%</Text>
                  </View>
                </View>
                <View style={s.planPriceRow}>
                  <Text
                    style={[
                      s.planPrice,
                      selectedPlan === "annual" && s.planPriceActive,
                    ]}
                  >
                    {annualPkg?.product.priceString ?? PRO_ANNUAL_PRICE}
                  </Text>
                  {selectedPlan === "annual" ? (
                    <Ionicons
                      name="checkmark-circle"
                      size={20}
                      color={C.accent}
                    />
                  ) : (
                    <View style={s.checkPlaceholder} />
                  )}
                </View>
              </View>
              <Text style={s.planSub}>
                {annualPkg
                  ? `~$${(annualPkg.product.price / 12).toFixed(2)}/mo`
                  : "~$1.67/mo"}
              </Text>
            </TouchableOpacity>

            {/* Monthly */}
            <TouchableOpacity
              style={[
                s.planCard,
                selectedPlan === "monthly" && s.planCardActive,
              ]}
              onPress={() => setSelectedPlan("monthly")}
              activeOpacity={0.8}
            >
              <View style={s.planCardTop}>
                <Text
                  style={[
                    s.planName,
                    selectedPlan === "monthly" && s.planNameActive,
                  ]}
                >
                  Monthly
                </Text>
                <View style={s.planPriceRow}>
                  <Text
                    style={[
                      s.planPrice,
                      selectedPlan === "monthly" && s.planPriceActive,
                    ]}
                  >
                    {monthlyPkg?.product.priceString ?? PRO_MONTHLY_PRICE}
                  </Text>
                  {selectedPlan === "monthly" ? (
                    <Ionicons
                      name="checkmark-circle"
                      size={20}
                      color={C.accent}
                    />
                  ) : (
                    <View style={s.checkPlaceholder} />
                  )}
                </View>
              </View>
              <Text style={s.planSub}>Billed monthly · cancel anytime</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Status message */}
        {statusMsg && (
          <Text
            style={[
              s.statusMsg,
              statusMsg.includes("Pro") ? s.statusSuccess : s.statusError,
            ]}
          >
            {statusMsg}
          </Text>
        )}

        {/* CTA */}
        <TouchableOpacity
          style={[s.ctaBtn, (!activePkg || isPurchasing) && s.ctaBtnDisabled]}
          onPress={handlePurchase}
          disabled={!activePkg || isPurchasing}
          activeOpacity={0.8}
        >
          {isPurchasing ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={s.ctaBtnText}>
              {activePkg
                ? `Get Pro · ${activePkg.product.priceString}`
                : "Get Pro"}
            </Text>
          )}
        </TouchableOpacity>

        {/* Restore + Legal */}
        <TouchableOpacity
          style={s.restoreBtn}
          onPress={handleRestore}
          disabled={isRestoring}
        >
          {isRestoring ? (
            <ActivityIndicator size="small" color={C.textTertiary} />
          ) : (
            <Text style={s.restoreText}>Restore Purchases</Text>
          )}
        </TouchableOpacity>

        {Platform.OS === "ios" && (
          <Text style={s.legalNote}>
            Subscriptions auto-renew unless cancelled at least 24 hours before
            the end of the current period in App Store settings.
          </Text>
        )}

        <View style={s.legalLinks}>
          <TouchableOpacity
            onPress={() => Linking.openURL("https://packapp.io/privacy")}
          >
            <Text style={s.legalLink}>Privacy Policy</Text>
          </TouchableOpacity>
          <Text style={s.legalDot}>·</Text>
          <TouchableOpacity
            onPress={() => Linking.openURL("https://packapp.io/terms")}
          >
            <Text style={s.legalLink}>Terms of Use</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  dismissRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  cancelBtn: { padding: 8, minWidth: 60 },
  cancelText: { fontSize: 16, color: C.textSecondary },
  closeBtn: { padding: 8 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 16, gap: 24 },

  header: { alignItems: "center", gap: 10 },
  proBadge: {
    backgroundColor: C.gold,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  proBadgeText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#000",
    letterSpacing: 1,
  },
  headline: {
    fontSize: 26,
    fontWeight: "800",
    color: C.textPrimary,
    textAlign: "center",
    letterSpacing: -0.5,
  },
  subheadline: { fontSize: 15, color: C.textSecondary, textAlign: "center" },

  featureList: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 16,
    gap: 12,
    borderWidth: 0.5,
    borderColor: C.border,
  },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  featureText: { fontSize: 14, color: C.textPrimary, flex: 1 },

  // Coming Soon — muted treatment so testers can tell roadmap rows apart
  // from current perks at a glance. "Soon" tag matches the accent-colored
  // trailing chip on profile/index.tsx integration rows.
  comingSoonSection: { gap: 8 },
  comingSoonHeader: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: C.textTertiary,
    marginLeft: 4,
  },
  comingSoonList: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 16,
    gap: 14,
    borderWidth: 0.5,
    borderColor: C.border,
  },
  comingSoonRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  comingSoonTextCol: { flex: 1, gap: 2 },
  comingSoonLabel: { fontSize: 14, color: C.textSecondary, fontWeight: "600" },
  comingSoonSubtitle: { fontSize: 12, color: C.textTertiary },
  comingSoonTag: { fontSize: 14, color: C.accent, fontWeight: "600" },

  plans: { gap: 10 },
  planCard: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: C.border,
    padding: 16,
    gap: 4,
  },
  planCardActive: { borderColor: C.accent, backgroundColor: C.surfaceRaised },
  planCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  planNameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  planName: { fontSize: 16, fontWeight: "700", color: C.textSecondary },
  planNameActive: { color: C.textPrimary },
  saveBadge: {
    backgroundColor: "#134B2F",
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  saveBadgeText: { fontSize: 11, fontWeight: "700", color: C.success },
  planPriceRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  planPrice: { fontSize: 18, fontWeight: "800", color: C.textSecondary },
  planPriceActive: { color: C.accent },
  checkPlaceholder: { width: 20, height: 20 },
  planSub: { fontSize: 12, color: C.textTertiary },

  statusMsg: { fontSize: 14, textAlign: "center", paddingHorizontal: 8 },
  statusSuccess: { color: C.success },
  statusError: { color: "#F85149" },

  ctaBtn: {
    backgroundColor: C.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  ctaBtnDisabled: { opacity: 0.5 },
  ctaBtnText: { fontSize: 17, fontWeight: "700", color: "#000" },

  restoreBtn: { alignItems: "center", paddingVertical: 8 },
  restoreText: { fontSize: 14, color: C.textTertiary },

  legalNote: {
    fontSize: 10,
    color: C.textTertiary,
    textAlign: "center",
    lineHeight: 15,
    paddingHorizontal: 8,
  },
  legalLinks: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  legalLink: { fontSize: 12, color: C.textTertiary },
  legalDot: { fontSize: 12, color: C.textTertiary },
});
