import React from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { colors } from "../theme/colors";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// Ring rendering rules — single source of truth
//
// Inside the ring (initial color + progress arc color):
//   1. If this member is the current pack leader → colors.leader (gold)
//   2. Else if this member is the current user → colors.self (blue)
//   3. Else → colors.member (neutral)
//
// Below the ring (rank badge):
//   - #1 always uses colors.leader (gold pill, gold text)
//   - #2, #3, etc. use neutral pill, neutral text
//   - Badge is shown for top 3 ranks only on both card and header variants
//
// Below the rank badge (name label):
//   - If this member is the current user → colors.self (blue text), display their actual name
//   - Else → colors.member (neutral text), display their actual name
//   - Do NOT add "(you)" or any tag — color is the self signal
//
// Edge case: if the current user IS the leader, the ring uses colors.leader
// (rule 1 wins over rule 2 for the ring). The name label below still uses
// colors.self. This is intentional — the gold ring is the celebration moment,
// the blue name preserves identity.

function getRingColor(
  memberId: string,
  currentUserId: string | undefined,
  leaderId: string | undefined,
): string {
  if (memberId === leaderId) return colors.leader;
  if (memberId === currentUserId) return colors.self;
  return colors.member;
}

function getNameColor(memberId: string, currentUserId: string | undefined): string {
  if (memberId === currentUserId) return colors.self;
  return colors.member;
}

interface PackMemberDisplayProps {
  userId: string;
  displayName: string;
  progressPct: number;        // 0–100, pre-computed by caller
  rank: number;
  currentUserId: string | undefined;
  leaderId: string | undefined; // user_id of the #1 ranked member
  size: number;                 // ring diameter in px
  strokeWidth: number;
  animValue?: Animated.Value;   // if provided → animated arc; else static
  showName?: boolean;           // default true; set false for compact strip rings
}

// Dim color for the initial letter when the member has no points yet.
// Not an identity color — just a layout signal for zero-progress state.
const RING_EMPTY_COLOR = "#484F58";

// Dark-theme surface colors shared across ring slot backgrounds.
const TRACK_LEADER = "#3A4150";
const TRACK_OTHER = "#30363D";
const BADGE_BG = "#1C2333";
const BADGE_BORDER = "#30363D";

export function PackMemberDisplay({
  userId,
  displayName,
  progressPct,
  rank,
  currentUserId,
  leaderId,
  size,
  strokeWidth,
  animValue,
  showName = true,
}: PackMemberDisplayProps) {
  const ringColor = getRingColor(userId, currentUserId, leaderId);
  const nameColor = getNameColor(userId, currentUserId);
  const hasPts = progressPct > 0;
  const isFirst = rank === 1;
  const initial = displayName.trim().charAt(0).toUpperCase() || "?";
  const cx = size / 2;
  const cy = size / 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const trackColor = isFirst ? TRACK_LEADER : TRACK_OTHER;
  const initialFontSize = Math.round(size * 0.27);
  const nameFontSize = size >= 90 ? 13 : size >= 65 ? 12 : 10;
  const nameFontWeight: "700" | "600" = isFirst ? "700" : "600";
  const badgePaddingH = size >= 90 ? 8 : 5;
  const badgeFontSize = size >= 90 ? 11 : 9;
  const staticOffset = circumference - (progressPct / 100) * circumference;

  return (
    <View style={s.slot}>
      {/* Ring */}
      <View
        style={{
          width: size,
          height: size,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Svg
          width={size}
          height={size}
          style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}
        >
          <Circle
            cx={cx}
            cy={cy}
            r={radius}
            stroke={trackColor}
            strokeWidth={strokeWidth}
            fill="none"
          />
          {animValue ? (
            <AnimatedCircle
              cx={cx}
              cy={cy}
              r={radius}
              stroke={ringColor}
              strokeWidth={strokeWidth}
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={animValue.interpolate({
                inputRange: [0, 100],
                outputRange: [circumference, 0],
              })}
              strokeLinecap="round"
              opacity={hasPts ? 1 : 0}
            />
          ) : (
            hasPts && (
              <Circle
                cx={cx}
                cy={cy}
                r={radius}
                stroke={ringColor}
                strokeWidth={strokeWidth}
                fill="none"
                strokeDasharray={circumference}
                strokeDashoffset={staticOffset}
                strokeLinecap="round"
              />
            )
          )}
        </Svg>
        <Text
          style={[
            s.initial,
            { fontSize: initialFontSize, color: hasPts ? ringColor : RING_EMPTY_COLOR },
          ]}
        >
          {initial}
        </Text>
      </View>

      {/* Rank badge — top 3 only */}
      {rank <= 3 && (
        <View
          style={[
            s.badge,
            { paddingHorizontal: badgePaddingH },
            isFirst && s.badgeFirst,
          ]}
        >
          <Text
            style={[
              s.badgeText,
              { fontSize: badgeFontSize },
              isFirst && s.badgeTextFirst,
            ]}
          >
            #{rank}
          </Text>
        </View>
      )}

      {/* Name */}
      {showName && (
        <Text
          style={[
            s.name,
            { fontSize: nameFontSize, fontWeight: nameFontWeight, color: nameColor },
          ]}
          numberOfLines={1}
        >
          {displayName}
        </Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  slot: {
    alignItems: "center",
    gap: 6,
  },
  initial: {
    fontWeight: "700",
  },
  badge: {
    borderRadius: 10,
    paddingVertical: 2,
    borderWidth: 0.5,
    backgroundColor: BADGE_BG,
    borderColor: BADGE_BORDER,
  },
  badgeFirst: {
    backgroundColor: colors.leaderBg,
    borderColor: colors.leaderBorder,
  },
  badgeText: {
    fontWeight: "700",
    color: colors.member,
  },
  badgeTextFirst: {
    color: colors.leader,
  },
  name: {
    textAlign: "center",
  },
});
