// Public user profile (Pass 21b). Modal-presented, route-driven by
// /user/[id]. Reachable from Home member cards, Compete tab avatars, and
// Chat avatars. Privacy is enforced server-side by get_user_public_profile
// — viewer must share at least one active pack with target (or be self).
//
// Read-only by design. Edit affordances live on the self-profile tab.
//
// Modal close MUST use router.dismiss() per the layout file convention
// (see app/(app)/pack/_layout.tsx for precedent).

import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  SafeAreaView,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useAuthStore } from "../../src/stores/authStore";
import { supabase } from "../../src/lib/supabase";
import { colors } from "../../src/theme/colors";
import { formatName, getInitial } from "../../src/lib/displayName";
import { userProfile, t } from "../../src/constants/strings";
import { useSuppressParentRefetchOnDismiss } from "../../src/context/ModalMutationContext";
import { StreakLine } from "../../src/components/profile/StreakLine";
import { StatSheetRow } from "../../src/components/profile/StatSheetRow";
import {
  PackRow,
  type SharedPackDetail,
} from "../../src/components/profile/PackRow";

// Trends section removed 2026-06-01 — it was self-contained, broken
// (misplaced on the public profile), and the chart will live in a
// premium feature later. The orphaned hook + chart files
// (src/hooks/useUserCategoryTrend.ts +
// src/components/trends/CategoryTrendChart.tsx) are LEFT DORMANT here
// for that future feature. Compete's banked PackTrendChart /
// usePackCategoryTrend are a SEPARATE code path and untouched.

const C = {
  bg: "#0B0F14",
  surface: "#121821",
  surfaceRaised: "#1C2333",
  border: "#30363D",
  textPrimary: "#E6EDF3",
  textSecondary: "#8B949E",
  textTertiary: "#484F58",
  accent: colors.self,
  danger: "#F85149",
  success: "#3FB950",
} as const;

const AVATAR_SIZE = 100;
const SHARED_PACKS_VISIBLE_DEFAULT = 3;

interface PublicProfileData {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
  current_streak: number;
  // Pass 21c additions — best-streak + 4 fitness totals across shared packs.
  best_streak: number;
  total_steps: number;
  total_workouts: number;
  total_calories: number;
  total_water_oz: number;
  // total_points_shared retained for backward compat; not rendered today.
  total_points_shared: number;
  shared_pack_count: number;
  // Pass 21d — per-pack head-to-head detail. Empty array when caller has
  // no shared packs with target (privacy gate already blocks this case
  // for non-self).
  shared_packs_detail: SharedPackDetail[];
}

// "Joined April 2026" via Intl. Explicit en-US locale (same convention as
// formatNextRunDate in pack/edit/[id].tsx — pre-launch app is English-only).
function formatMemberSince(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// Comma-separated number formatting for fitness totals (Pass 21c). Single
// helper applies to all four metrics (steps, workouts, calories, water_oz).
// Explicit en-US locale to match formatMemberSince + Pass 20e convention.
function formatStatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

// Full English ordinal (1 → "1st", 2 → "2nd", 11/12/13 → "11th"…).
// File-local — PackCompeteView has the same helper, and PackRow has a
// suffix-only variant used via template; reuse isn't worth a refactor for
// 9 lines. Consumed by the pack-context summary block only.
function ordinal(n: number): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  const last = n % 10;
  if (last === 1) return `${n}st`;
  if (last === 2) return `${n}nd`;
  if (last === 3) return `${n}rd`;
  return `${n}th`;
}

function classifyError(message: string): string {
  // Map RPC RAISE EXCEPTION strings to placeholder copy. Voice review
  // refines later; the error variants stay stable contracts.
  if (message.includes("not visible") || message.includes("no shared")) {
    return userProfile.errors.notVisible;
  }
  if (message.includes("not found")) {
    return userProfile.errors.notFound;
  }
  return userProfile.errors.network;
}

export default function UserProfileScreen() {
  // ── READ-ONLY MODAL CONTRACT ─────────────────────────────────────────
  // This screen is read-only — opening it never mutates parent state.
  // The hook below schedules a "skip the next focus-refetch" flag on
  // unmount, eliminating a wasted query + visible reload cycle on the
  // parent screen (Home or Pack Detail) when this modal dismisses.
  //
  // The hook returns cancelOnNav: call it before router.push() in the
  // deep-link handler so the destination screen (e.g., Pack Detail for a
  // pack the user wasn't already viewing) refetches normally on its
  // first focus event. Without this, the suppression flag persists and
  // the destination silently skips its initial refetch.
  //
  // ⚠️ READ-ONLY MODAL CONTRACT — if mutating actions are ever added to
  // this screen (block user, report, follow, send message, etc.), the
  // useSuppressParentRefetchOnDismiss() call below MUST be removed —
  // the parent must refetch to reflect the mutation. Removing the call
  // restores Pass 20a-f's default refetch-on-focus behavior.
  // ─────────────────────────────────────────────────────────────────────
  const cancelSuppressionOnNav = useSuppressParentRefetchOnDismiss();

  // packId carries pack context from the calling surface (PackGridView
  // avatar, Home MemberCard, Compete bar/card taps, Chat/FeedItemRow
  // avatars). When present and the profile shares that pack with the
  // viewer, the pack-context summary block below renders the target's
  // rank + run points + today's points for that pack's active run.
  // Other callers omit packId, in which case the summary is suppressed
  // and the profile renders without it.
  const { id: targetUserId, packId } = useLocalSearchParams<{
    id: string;
    packId?: string;
  }>();
  const router = useRouter();
  const currentUser = useAuthStore((s) => s.user);
  const [packsExpanded, setPacksExpanded] = useState(false);

  // Deep-link handler for Shared packs rows. Per Pass 21c-followup:
  // cancel the suppression flag BEFORE dismiss so the destination
  // (Pack Detail for a different pack) refetches on first focus.
  // dismiss-then-push (D-NAVIGATION-FROM-MODAL) — predictable two-step
  // transition over single-replace which has SDK-version-dependent
  // presentation inheritance behavior.
  const handlePackTap = useCallback(
    (packId: string) => {
      cancelSuppressionOnNav();
      router.dismiss();
      router.push(`/(app)/pack/${packId}` as any);
    },
    [cancelSuppressionOnNav, router],
  );
  const isSelf = !!currentUser && currentUser.id === targetUserId;

  const [profile, setProfile] = useState<PublicProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Trends-only state (pack / activeRunId / selectedCategory) removed
  // 2026-06-01 along with the Trends section.

  const load = useCallback(async () => {
    if (!targetUserId) return;
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc(
      "get_user_public_profile",
      { target_user_id: targetUserId },
    );
    if (rpcError) {
      setError(classifyError(rpcError.message));
    } else {
      setProfile(data as PublicProfileData);
    }
    setLoading(false);
  }, [targetUserId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!targetUserId) return;
      const { data, error: rpcError } = await supabase.rpc(
        "get_user_public_profile",
        { target_user_id: targetUserId },
      );
      if (cancelled) return;
      if (rpcError) {
        setError(classifyError(rpcError.message));
      } else {
        setProfile(data as PublicProfileData);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [targetUserId]);

  // Trends-only effects (pack fetch / active-run fetch /
  // selectedCategory sync), the enabledCategories memo, the
  // trendsSectionEligible boolean, the useUserCategoryTrend hook call,
  // and the chartWidth screenWidth derivation all removed 2026-06-01.

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => router.dismiss()}
          style={s.closeBtn}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={userProfile.screen.close}
        >
          <Ionicons name="chevron-down" size={22} color={C.textPrimary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>{userProfile.screen.title}</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={C.accent} />
        </View>
      ) : error ? (
        <View style={s.center}>
          <Text style={s.errorText}>{error}</Text>
          {error === userProfile.errors.network && (
            <TouchableOpacity
              style={s.retryBtn}
              onPress={load}
              activeOpacity={0.7}
            >
              <Text style={s.retryBtnText}>{userProfile.errors.retry}</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : profile ? (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Avatar + identity */}
          <View style={s.avatarSection}>
            {profile.avatar_url ? (
              <Image
                source={{ uri: profile.avatar_url }}
                style={s.avatar}
              />
            ) : (
              <View style={[s.avatar, s.avatarFallback]}>
                <Text style={s.avatarInitial}>
                  {getInitial(profile.display_name)}
                </Text>
              </View>
            )}
            <Text style={s.displayName}>
              {formatName(profile.display_name)}
            </Text>
            <Text style={s.memberSince}>
              {t(userProfile.screen.memberSince, {
                date: formatMemberSince(profile.created_at),
              })}
            </Text>
          </View>

          {/* Pack-context summary — when the caller passed `?packId=...`
              AND that pack is in the viewer's shared list AND has an
              active run, show the target's standing in that pack's
              current run (rank, run points, today's points). Lands the
              viewer in competition context after tapping a Compete
              bar/card. Suppressed cleanly when packId is absent or the
              pack has no active run. */}
          {(() => {
            const packStat = packId
              ? profile.shared_packs_detail.find((r) => r.pack_id === packId)
              : undefined;
            if (!packStat || !packStat.has_active_run) return null;
            // All-zero guard mirrors Compete's start-of-run treatment:
            // showing "1st" on a fresh run when nobody has scored yet is
            // misleading. Today's value is shown as-is — 0 today is
            // meaningful, distinct from a fresh-run rank artifact.
            const rankDisplay =
              packStat.target_points === 0
                ? "—"
                : ordinal(packStat.target_rank);
            return (
              <View style={s.section}>
                <Text style={s.sectionHeader}>{packStat.pack_name}</Text>
                <View style={s.packSummaryRow}>
                  <View style={s.packSummaryStat}>
                    <Text style={s.packSummaryValue}>{rankDisplay}</Text>
                    <Text style={s.packSummaryLabel}>Rank</Text>
                  </View>
                  <View style={s.packSummaryStat}>
                    <Text style={s.packSummaryValue}>
                      {packStat.target_points}
                    </Text>
                    <Text style={s.packSummaryLabel}>Run points</Text>
                  </View>
                  <View style={s.packSummaryStat}>
                    <Text style={s.packSummaryValue}>
                      {packStat.target_today_points}
                    </Text>
                    <Text style={s.packSummaryLabel}>Today</Text>
                  </View>
                </View>
              </View>
            );
          })()}

          {/* Streak line — shared component (Pass 22). Active vs broken
              treatment + best suffix gating live in the StreakLine
              primitive; this consumer just passes the RPC values.    */}
          <StreakLine
            currentStreak={profile.current_streak}
            bestStreak={profile.best_streak}
          />

          {/* Shared packs section — the headline (Pass 21d).
              Per-row competitive signal: head-to-head delta (other-view)
              or rank-out-of-N (self-view). Capped at 3 visible rows;
              "+N more" disclosure expands inline. */}
          {profile.shared_packs_detail.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionHeader}>
                {(() => {
                  const n = profile.shared_packs_detail.length;
                  if (isSelf) {
                    return n === 1
                      ? userProfile.section.yourPack
                      : userProfile.section.yourPacks;
                  }
                  return n === 1
                    ? userProfile.section.sharedPack
                    : userProfile.section.sharedPacks;
                })()}
              </Text>
              {(packsExpanded
                ? profile.shared_packs_detail
                : profile.shared_packs_detail.slice(
                    0,
                    SHARED_PACKS_VISIBLE_DEFAULT,
                  )
              ).map((row) => (
                <PackRow
                  key={row.pack_id}
                  row={row}
                  isSelf={isSelf}
                  onPress={() => handlePackTap(row.pack_id)}
                />
              ))}
              {!packsExpanded &&
                profile.shared_packs_detail.length >
                  SHARED_PACKS_VISIBLE_DEFAULT && (
                  <TouchableOpacity
                    style={s.packMoreRow}
                    onPress={() => setPacksExpanded(true)}
                    activeOpacity={0.7}
                  >
                    <Text style={s.packMoreText}>
                      {t(userProfile.disclosure.moreFmt, {
                        count:
                          profile.shared_packs_detail.length -
                          SHARED_PACKS_VISIBLE_DEFAULT,
                      })}
                    </Text>
                  </TouchableOpacity>
                )}
            </View>
          )}

          {/* Lifetime totals — demoted stat-sheet, no boxes (Pass 21d).
              Each row: monoline icon + label left-aligned, comma-separated
              number right-aligned, hairline divider between rows.
              All four icons render in C.textSecondary (#8B949E). Color is
              reserved for competitive signal — head-to-head delta
              (green/red) and active streak (red) — not category branding
              on lifetime stats. If a future pass adds category color to
              all four icons consistently this can change, but one colored
              icon among three monochrome icons is visual noise. */}
          <View style={s.section}>
            <Text style={s.sectionHeader}>
              {userProfile.section.lifetime}
            </Text>
            <StatSheetRow
              icon={
                <MaterialCommunityIcons
                  name="shoe-print"
                  size={18}
                  color={C.textSecondary}
                />
              }
              label={userProfile.lifetime.steps}
              value={formatStatNumber(profile.total_steps)}
            />
            <StatSheetRow
              icon={
                <MaterialCommunityIcons
                  name="dumbbell"
                  size={18}
                  color={C.textSecondary}
                />
              }
              label={userProfile.lifetime.workouts}
              value={formatStatNumber(profile.total_workouts)}
            />
            <StatSheetRow
              icon={
                <MaterialCommunityIcons
                  name="fire"
                  size={18}
                  color={C.textSecondary}
                />
              }
              label={userProfile.lifetime.calories}
              value={formatStatNumber(profile.total_calories)}
            />
            <StatSheetRow
              icon={<Ionicons name="water" size={18} color={C.textSecondary} />}
              label={userProfile.lifetime.water}
              value={formatStatNumber(profile.total_water_oz)}
              isLast
            />
          </View>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: C.bg,
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
    gap: 8,
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
    color: C.textPrimary,
    textAlign: "center",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 16,
  },
  errorText: {
    fontSize: 14,
    color: C.textSecondary,
    textAlign: "center",
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: C.surface,
    borderWidth: 0.5,
    borderColor: C.border,
  },
  retryBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: C.accent,
  },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 24 },
  avatarSection: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 20,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarFallback: {
    backgroundColor: C.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    fontSize: 40,
    fontWeight: "700",
    color: C.textPrimary,
  },
  displayName: {
    fontSize: 22,
    fontWeight: "700",
    color: C.textPrimary,
    marginTop: 4,
  },
  memberSince: {
    fontSize: 13,
    color: C.textSecondary,
    fontWeight: "500",
  },
  // ── Section header + container (kept for the local sectioned layout;
  //    StatSheetRow/PackRow/StreakLine carry their own internal styles)
  section: {
    gap: 8,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "700",
    color: C.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.08 * 11,
    marginBottom: 4,
  },
  // ── "+N more" disclosure row (Pass 21d) ───────────────────────
  packMoreRow: {
    paddingVertical: 12,
    alignItems: "center",
  },
  packMoreText: {
    fontSize: 13,
    fontWeight: "500",
    color: C.accent,
  },
  // ── Pack-context summary block (2026-06-01) ───────────────────
  // Three stats laid out in a single row: rank, run points, today.
  // Centered numbers (large), secondary labels (small, uppercase tone
  // via weight not transform — labels are short enough). No card
  // chrome — the parent section's gap + section header provide
  // grouping, matching the other sections on this screen.
  packSummaryRow: {
    flexDirection: "row",
    paddingVertical: 8,
  },
  packSummaryStat: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  packSummaryValue: {
    fontSize: 22,
    fontWeight: "700",
    color: C.textPrimary,
  },
  packSummaryLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: C.textSecondary,
  },
  // Trends-section styles (trendsTabRow / trendsTab / trendsTabActive /
  // trendsTabLabel / trendsTabLabelActive / trendsLoadingBox) removed
  // 2026-06-01 with the Trends section.
});
