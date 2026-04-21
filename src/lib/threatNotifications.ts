import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { POINTS } from "./scoring";
import { getTokensForUsers, getOptedOutUsers } from "./notifications";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface RankedMember {
  userId: string;
  displayName: string;
  runPoints: number;
}

type ThreatKind = "took_lead" | "passed_you" | "tied_you" | "one_action_away";

interface ThreatEvent {
  kind: ThreatKind;
  victimId: string;
  actorName: string;
  rankAfter?: number;
  actionLabel?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dedup — AsyncStorage, 4-hour cooldown per (pack, actor, victim, kind)
// Prevents sending the same threat for the same state transition repeatedly.
// ─────────────────────────────────────────────────────────────────────────────

const COOLDOWN_MS = 4 * 60 * 60 * 1000;

async function canSendThreat(
  packId: string,
  actorId: string,
  victimId: string,
  kind: ThreatKind,
): Promise<boolean> {
  try {
    const key = `threat:${packId}:${actorId}:${victimId}:${kind}`;
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return true;
    return Date.now() - parseInt(raw, 10) > COOLDOWN_MS;
  } catch {
    return true; // fail open
  }
}

async function markThreatSent(
  packId: string,
  actorId: string,
  victimId: string,
  kind: ThreatKind,
): Promise<void> {
  try {
    const key = `threat:${packId}:${actorId}:${victimId}:${kind}`;
    await AsyncStorage.setItem(key, String(Date.now()));
  } catch {
    // non-critical
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// "One action away" label
// Thresholds match POINTS values (no multiplier — conservative approximation).
// gap ≤ 8  (water)   → "one water goal"
// gap ≤ 10 (steps)   → "one goal"
// gap ≤ 15 (workout) → "one workout"
// ─────────────────────────────────────────────────────────────────────────────

function oneActionLabel(gap: number): string | null {
  if (gap <= 0 || gap > POINTS.workout) return null;
  if (gap <= POINTS.water) return "one water goal";
  if (gap <= POINTS.steps) return "one goal";
  return "one workout";
}

// ─────────────────────────────────────────────────────────────────────────────
// Core threat detection — pure function, no side effects
//
// before / after: full run leaderboard sorted by runPoints desc.
// Returns one ThreatEvent per directly-impacted victim.
// ─────────────────────────────────────────────────────────────────────────────

export function detectThreats(
  actorId: string,
  actorName: string,
  before: RankedMember[],
  after: RankedMember[],
): ThreatEvent[] {
  const threats: ThreatEvent[] = [];
  if (after.length < 2) return threats;

  const actorBefore = before.find((m) => m.userId === actorId);
  const actorAfter  = after.find((m)  => m.userId === actorId);
  if (!actorBefore || !actorAfter) return threats;

  const actorNowLeads   = after[0]?.userId === actorId;

  for (const victim of after) {
    if (victim.userId === actorId) continue;

    const vBefore = before.find((m) => m.userId === victim.userId);
    if (!vBefore) continue;

    const actorWasStrictlyBehind = actorBefore.runPoints < vBefore.runPoints;
    const actorIsNowStrictlyAhead = actorAfter.runPoints > victim.runPoints;
    const victimWasLeader = before[0]?.userId === victim.userId;
    const victimNewRank = after.findIndex((m) => m.userId === victim.userId) + 1;

    // ── 1. Actor took the lead from this victim ─────────────────────────────
    if (victimWasLeader && actorNowLeads && actorIsNowStrictlyAhead) {
      threats.push({ kind: "took_lead", victimId: victim.userId, actorName });
      continue; // supersedes all other events for this victim
    }

    // ── 2. Actor passed this victim (moved strictly above, not to #1) ───────
    if (actorWasStrictlyBehind && actorIsNowStrictlyAhead) {
      threats.push({ kind: "passed_you", victimId: victim.userId, actorName, rankAfter: victimNewRank });
      continue;
    }

    // ── 3. Actor tied this victim (was behind, now equal) ───────────────────
    if (actorWasStrictlyBehind && actorAfter.runPoints === victim.runPoints) {
      threats.push({ kind: "tied_you", victimId: victim.userId, actorName, rankAfter: victimNewRank });
      continue;
    }

    // ── 4. Actor newly entered one-action range of catching victim ───────────
    // Only fires when crossing into the ≤ workout-pts threshold from outside it.
    if (!actorIsNowStrictlyAhead && actorAfter.runPoints < victim.runPoints) {
      const gapBefore = vBefore.runPoints - actorBefore.runPoints;
      const gapAfter  = victim.runPoints  - actorAfter.runPoints;
      const label = oneActionLabel(gapAfter);

      if (label && gapBefore > POINTS.workout) {
        threats.push({ kind: "one_action_away", victimId: victim.userId, actorName, actionLabel: label });
      }
    }
  }

  return threats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification copy
// ─────────────────────────────────────────────────────────────────────────────

function buildThreatCopy(event: ThreatEvent): { title: string; body: string } {
  switch (event.kind) {
    case "took_lead":
      return { title: "👑 Lead Change", body: `${event.actorName} took the lead` };
    case "passed_you":
      return { title: "📉 You Dropped", body: `${event.actorName} passed you — you're now #${event.rankAfter}` };
    case "tied_you":
      return { title: "⚡ Tied Up", body: `${event.actorName} tied you for #${event.rankAfter}` };
    case "one_action_away":
      return { title: "⚠️ Closing In", body: `${event.actorName} is ${event.actionLabel} away from passing you` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
//
// Call after any daily_scores upsert that increases the actor's today score.
// todayPointsDelta: newTodayScore - oldTodayScore (skip if ≤ 0)
// ─────────────────────────────────────────────────────────────────────────────

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export async function detectAndSendThreatNotifications(
  actorId: string,
  packId: string,
  runId: string,
  todayPointsDelta: number,
): Promise<void> {
  if (todayPointsDelta <= 0) return;

  try {
    // Fetch run leaderboard + actor name in parallel
    const [scoresResult, actorResult] = await Promise.all([
      supabase.from("daily_scores").select("user_id, total_points").eq("run_id", runId),
      supabase.from("users").select("display_name").eq("id", actorId).maybeSingle(),
    ]);

    if (!scoresResult.data?.length) return;
    const actorName = actorResult.data?.display_name ?? "A pack member";

    // Aggregate run totals per user
    const runTotals: Record<string, number> = {};
    scoresResult.data.forEach((row) => {
      runTotals[row.user_id] = (runTotals[row.user_id] ?? 0) + row.total_points;
    });

    // Fetch display names
    const userIds = Object.keys(runTotals);
    const { data: usersData } = await supabase
      .from("users").select("id, display_name").in("id", userIds);
    const nameMap: Record<string, string> = {};
    (usersData ?? []).forEach((u) => { nameMap[u.id] = u.display_name ?? "Unknown"; });

    // Build AFTER leaderboard
    const afterUnsorted: RankedMember[] = userIds.map((uid) => ({
      userId: uid,
      displayName: nameMap[uid] ?? "Unknown",
      runPoints: runTotals[uid] ?? 0,
    }));
    const after = [...afterUnsorted].sort((a, b) => b.runPoints - a.runPoints);

    // Reconstruct BEFORE by subtracting delta from actor's run total only
    const before = after
      .map((m) =>
        m.userId === actorId
          ? { ...m, runPoints: Math.max(0, m.runPoints - todayPointsDelta) }
          : m,
      )
      .sort((a, b) => b.runPoints - a.runPoints);

    const threats = detectThreats(actorId, actorName, before, after);
    if (threats.length === 0) return;

    // Batch-fetch victim push tokens + pref opt-outs
    const victimIds = [...new Set(threats.map((t) => t.victimId))];
    const [tokenMap, optedOut] = await Promise.all([
      getTokensForUsers(victimIds),
      getOptedOutUsers(victimIds, "overtaken"),
    ]);

    // Build message list, checking dedup for each threat
    const messages: Array<{ to: string; title: string; body: string; sound: string; data: Record<string, string> }> = [];
    for (const threat of threats) {
      if (optedOut.has(threat.victimId)) continue;
      const tokens = tokenMap[threat.victimId] ?? [];
      if (tokens.length === 0) continue;

      const allowed = await canSendThreat(packId, actorId, threat.victimId, threat.kind);
      if (!allowed) continue;

      const { title, body } = buildThreatCopy(threat);
      for (const token of tokens) {
        messages.push({ to: token, title, body, sound: "default", data: { packId } });
      }
      await markThreatSent(packId, actorId, threat.victimId, threat.kind);
    }

    if (messages.length === 0) return;

    await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
  } catch (err) {
    console.error("[threatNotifications] error:", err);
  }
}
