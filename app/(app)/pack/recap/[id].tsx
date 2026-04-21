import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { usePackHistory } from "../../../../src/hooks/usePackHistory";
import { colors } from "../../../../src/theme/colors";

const MONTHS = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec",
];

function formatDateRange(startedAt: string, endedAt: string): string {
  const s = new Date(startedAt);
  const e = new Date(endedAt);
  return `${MONTHS[s.getMonth()]} ${s.getDate()} – ${MONTHS[e.getMonth()]} ${e.getDate()}`;
}

function AvatarCircle({
  name,
  size,
  bg,
}: {
  name: string;
  size: number;
  bg: string;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          fontSize: Math.round(size * 0.4),
          fontWeight: "700",
          color: "#FFFFFF",
        }}
      >
        {initial}
      </Text>
    </View>
  );
}

export default function RecapScreen() {
  const { id: runId, packId } = useLocalSearchParams<{
    id: string;
    packId: string;
  }>();
  const router = useRouter();
  const { completedRuns, isLoading } = usePackHistory(packId ?? "");

  if (isLoading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  const run = completedRuns.find((r) => r.runId === runId);

  if (!run) {
    return (
      <View style={s.center}>
        <Text style={s.errorText}>Recap not found</Text>
      </View>
    );
  }

  const winnerPts = run.winner.totalPoints;
  const second = run.standings[1];
  const third = run.standings[2];

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.content}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.weekLabel}>
          Week of {formatDateRange(run.startedAt, run.endedAt)}
        </Text>
      </View>

      {/* Hero */}
      <View style={s.hero}>
        <Text style={s.trophy}>🏆</Text>
        <AvatarCircle name={run.winner.displayName} size={64} bg={colors.leader} />
        <Text style={s.winnerName}>{run.winner.displayName}</Text>
        <Text style={s.winnerPts}>{run.winner.totalPoints} pts</Text>
      </View>

      {/* Podium — #2 and #3 */}
      {second && third && (
        <View style={s.podium}>
          <View style={s.podiumSlot}>
            <AvatarCircle name={second.displayName} size={40} bg="#1F2937" />
            <Text style={s.podiumRank}>#2</Text>
            <Text style={s.podiumName} numberOfLines={1}>
              {second.displayName}
            </Text>
            <Text style={s.podiumPts}>{second.totalPoints} pts</Text>
          </View>
          <View style={s.podiumSlot}>
            <AvatarCircle name={third.displayName} size={40} bg="#1F2937" />
            <Text style={s.podiumRank}>#3</Text>
            <Text style={s.podiumName} numberOfLines={1}>
              {third.displayName}
            </Text>
            <Text style={s.podiumPts}>{third.totalPoints} pts</Text>
          </View>
        </View>
      )}

      {/* Full standings */}
      <View style={s.standingsCard}>
        <Text style={s.standingsTitle}>STANDINGS</Text>
        {run.standings.map((standing) => {
          const barPct =
            winnerPts > 0
              ? Math.min(100, Math.round((standing.totalPoints / winnerPts) * 100))
              : 0;
          return (
            <View
              key={`${standing.rank}-${standing.displayName}`}
              style={s.standingRow}
            >
              <Text style={s.standingRank}>#{standing.rank}</Text>
              <View style={s.standingInfo}>
                <View style={s.standingMeta}>
                  <Text style={s.standingName} numberOfLines={1}>
                    {standing.displayName}
                  </Text>
                  <Text style={s.standingPts}>{standing.totalPoints} pts</Text>
                </View>
                <View style={s.barTrack}>
                  <View
                    style={[
                      s.barFill,
                      {
                        width: `${barPct}%` as `${number}%`,
                        backgroundColor:
                          standing.rank === 1 ? colors.leader : colors.accent,
                      },
                    ]}
                  />
                </View>
              </View>
            </View>
          );
        })}
      </View>

      {/* CTA */}
      <TouchableOpacity
        style={s.ctaBtn}
        onPress={() => router.replace(`/(app)/pack/${packId}` as any)}
        activeOpacity={0.85}
      >
        <Text style={s.ctaText}>This week is live →</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: "#0A0A0A" },
  content: { paddingBottom: 48 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0A0A0A",
  },
  errorText: { color: "#9CA3AF", fontSize: 16 },
  header: {
    paddingTop: 60,
    paddingHorizontal: 16,
    paddingBottom: 20,
    gap: 8,
  },
  backText: { color: "#9CA3AF", fontSize: 15, fontWeight: "500" },
  weekLabel: { fontSize: 13, color: "#9CA3AF", fontWeight: "600", letterSpacing: 0.3 },
  hero: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 12,
    backgroundColor: "#111827",
    marginHorizontal: 16,
    borderRadius: 16,
  },
  trophy: { fontSize: 48 },
  winnerName: { fontSize: 24, fontWeight: "700", color: "#FFFFFF" },
  winnerPts: { fontSize: 16, color: colors.leader, fontWeight: "600" },
  podium: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 48,
    paddingVertical: 28,
  },
  podiumSlot: { alignItems: "center", gap: 6 },
  podiumRank: {
    fontSize: 11,
    color: "#9CA3AF",
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  podiumName: {
    fontSize: 13,
    color: "#FFFFFF",
    fontWeight: "600",
    maxWidth: 88,
    textAlign: "center",
  },
  podiumPts: { fontSize: 12, color: "#9CA3AF" },
  standingsCard: {
    backgroundColor: "#111827",
    marginHorizontal: 16,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  standingsTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 1.0,
    marginBottom: 12,
  },
  standingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1F2937",
  },
  standingRank: { fontSize: 13, color: "#9CA3AF", width: 28 },
  standingInfo: { flex: 1, gap: 6 },
  standingMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  standingName: {
    fontSize: 14,
    color: "#FFFFFF",
    fontWeight: "600",
    flex: 1,
  },
  standingPts: { fontSize: 14, color: "#FFFFFF", fontWeight: "700" },
  barTrack: {
    height: 3,
    backgroundColor: "#1F2937",
    borderRadius: 2,
    overflow: "hidden",
  },
  barFill: { height: 3, borderRadius: 2 },
  ctaBtn: {
    backgroundColor: colors.accent,
    marginHorizontal: 16,
    marginTop: 24,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  ctaText: { color: "#FFFFFF", fontWeight: "700", fontSize: 16 },
});
