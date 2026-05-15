import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { POINTS } from "./scoring";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface RankedMember {
  userId: string;
  displayName: string;
  runPoints: number;
}

// Pass 25-followup-E.2.a.iii: took_lead removed from this union. The
// took_lead INSERT + push are now owned by detectAndRecordTookLead in
// src/lib/competitiveDetection.ts. This file retains only victim-targeted
// threats (passed_you / tied_you / one_action_away).
type ThreatKind = "passed_you" | "tied_you" | "one_action_away";

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
// Stays client-side: protects against the actor's device firing the same push
// multiple times in a session. Server-side dedup is a future enhancement.
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

  for (const victim of after) {
    if (victim.userId === actorId) continue;

    const vBefore = before.find((m) => m.userId === victim.userId);
    if (!vBefore) continue;

    const actorWasStrictlyBehind = actorBefore.runPoints < vBefore.runPoints;
    const actorIsNowStrictlyAhead = actorAfter.runPoints > victim.runPoints;
    const victimNewRank = after.findIndex((m) => m.userId === victim.userId) + 1;

    // ── 1. Actor passed this victim (moved strictly above) ─────────────────
    // took_lead removed in Pass 25-followup-E.2.a.iii — owned by
    // detectAndRecordTookLead. passed_you fires regardless of whether the
    // victim was the leader; if they were, the broadcast took_lead from
    // competitiveDetection.ts also fires (the two events are not mutually
    // exclusive post-consolidation).
    if (actorWasStrictlyBehind && actorIsNowStrictlyAhead) {
      threats.push({ kind: "passed_you", victimId: victim.userId, actorName, rankAfter: victimNewRank });
      continue;
    }

    // ── 2. Actor tied this victim (was behind, now equal) ───────────────────
    if (actorWasStrictlyBehind && actorAfter.runPoints === victim.runPoints) {
      threats.push({ kind: "tied_you", victimId: victim.userId, actorName, rankAfter: victimNewRank });
      continue;
    }

    // ── 3. Actor newly entered one-action range of catching victim ─────────
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
// Edge function payload mapping. Mirrors the victim-targeted subset of the
// discriminated union in supabase/functions/notify-pack-event/index.ts.
// took_lead is owned by competitiveDetection.ts post-Pass-25-followup-E.2.a.iii
// — that path fires the broadcast push there. The three kinds here are all
// targeted at the specific victim via the recipients filter.
// ─────────────────────────────────────────────────────────────────────────────

type EdgeEvent =
  | { kind: "passed_you"; rankAfter: number }
  | { kind: "tied_you"; rankAfter: number }
  | { kind: "one_action_away"; actionLabel: string };

function buildEdgePayload(
  threat: ThreatEvent,
  packId: string,
): { packId: string; event: EdgeEvent; recipients?: string[] } {
  switch (threat.kind) {
    case "passed_you":
      return {
        packId,
        event: { kind: "passed_you", rankAfter: threat.rankAfter ?? 0 },
        recipients: [threat.victimId],
      };
    case "tied_you":
      return {
        packId,
        event: { kind: "tied_you", rankAfter: threat.rankAfter ?? 0 },
        recipients: [threat.victimId],
      };
    case "one_action_away":
      return {
        packId,
        event: { kind: "one_action_away", actionLabel: threat.actionLabel ?? "one goal" },
        recipients: [threat.victimId],
      };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
//
// Call after any daily_scores upsert that increases the actor's today score.
// todayPointsDelta: newTodayScore - oldTodayScore (skip if ≤ 0)
// ─────────────────────────────────────────────────────────────────────────────

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

    // Per-threat dispatch — cooldown gates resend; the edge function handles
    // recipient resolution, opt-out checks, and Expo push delivery.
    for (const threat of threats) {
      const allowed = await canSendThreat(packId, actorId, threat.victimId, threat.kind);
      if (!allowed) continue;

      const body = buildEdgePayload(threat, packId);
      const { data, error } = await supabase.functions.invoke("notify-pack-event", { body });
      if (error) {
        console.error("[threatNotifications] invoke failed:", error);
        continue;
      }
      console.log("[threatNotifications] dispatch ok:", data);
      await markThreatSent(packId, actorId, threat.victimId, threat.kind);
    }
  } catch (err) {
    console.error("[threatNotifications] error:", err);
  }
}
