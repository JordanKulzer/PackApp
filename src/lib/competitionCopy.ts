// Single source of truth for competition copy.
// Both Home cards and Pack TODAY section derive messaging from these helpers
// so rank, gap, and action text cannot diverge.

import { formatName } from "./displayName";

// Minimum shape for copy generation. HomeScore and MemberScore both satisfy this.
export interface RankedEntry {
  user_id: string;
  display_name: string;
  weekly_points: number;
  streak_days?: number;
  updated_at?: string | null;
}

export type TiebreakerReason = "streak" | "time" | null;

export type RankedWithTiebreaker<T extends RankedEntry> = T & {
  rank: number;
  tiebreaker: TiebreakerReason; // why I beat the next same-pts person; null = genuine tie or no rival
  isTied: boolean; // am I in a genuine tie group with any adjacent same-pts member
};

// Sort members by weekly_points desc, then streak desc, then updated_at asc (earliest = "got there first").
// Returns competition ranks: genuine-tied members share the same rank; next rank skips.
export function rankWithTiebreakers<T extends RankedEntry>(
  members: T[],
): RankedWithTiebreaker<T>[] {
  if (!members.length) return [];

  const sorted = [...members].sort((a, b) => {
    if (b.weekly_points !== a.weekly_points) return b.weekly_points - a.weekly_points;
    const as = a.streak_days ?? 0, bs = b.streak_days ?? 0;
    if (bs !== as) return bs - as;
    const at = a.updated_at ? new Date(a.updated_at).getTime() : Infinity;
    const bt = b.updated_at ? new Date(b.updated_at).getTime() : Infinity;
    return at - bt;
  });

  const result: RankedWithTiebreaker<T>[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const member = sorted[i];
    const prevRaw = i > 0 ? sorted[i - 1] : null;
    const prevResult = i > 0 ? result[i - 1] : null;
    const next = i < sorted.length - 1 ? sorted[i + 1] : null;

    // Genuine tie = same on all three tiebreaker fields
    const tiedWithPrev =
      !!prevRaw &&
      prevRaw.weekly_points === member.weekly_points &&
      (prevRaw.streak_days ?? 0) === (member.streak_days ?? 0) &&
      (prevRaw.updated_at ?? null) === (member.updated_at ?? null);

    // Competition ranking: share rank on genuine ties, skip on tiebreaker-resolved
    const rank = tiedWithPrev ? prevResult!.rank : i + 1;

    // Why do I beat the next same-pts person?
    let tiebreaker: TiebreakerReason = null;
    if (next && next.weekly_points === member.weekly_points) {
      const ms = member.streak_days ?? 0, ns = next.streak_days ?? 0;
      if (ms > ns) tiebreaker = "streak";
      else if (ms === ns) {
        const mt = member.updated_at ?? null, nt = next.updated_at ?? null;
        if (mt !== nt) tiebreaker = "time";
      }
    }

    const tiedWithNext =
      !!next &&
      next.weekly_points === member.weekly_points &&
      (next.streak_days ?? 0) === (member.streak_days ?? 0) &&
      (next.updated_at ?? null) === (member.updated_at ?? null);

    result.push({ ...member, rank, tiebreaker, isTied: tiedWithPrev || tiedWithNext });
  }

  return result;
}

// ─── Rank status headline ──────────────────────────────────────────────────────
// Returns the primary status string with correct tie detection.
// "You're #1 · Leading by 20 pts" / "Tied for #1" / "Tied for #2" /
// "You're #3 · 15 pts behind Lauren" / "You're #1 · No rivals yet"
// Accepts plain RankedEntry[] or pre-ranked RankedWithTiebreaker<>[] arrays.
export function buildRankStatus(
  members: RankedEntry[],
  myUserId: string | undefined,
): string {
  if (!myUserId || members.length === 0) return "No activity yet this week";

  // Use pre-ranked array if provided (has .rank field), otherwise rank here.
  const ranked = (members[0] as RankedWithTiebreaker<RankedEntry>).rank !== undefined
    ? (members as RankedWithTiebreaker<RankedEntry>[])
    : rankWithTiebreakers(members);

  const myIndex = ranked.findIndex((r) => r.user_id === myUserId);
  if (myIndex < 0) return "No activity yet this week";

  const me = ranked[myIndex];
  const myPts = me.weekly_points;
  const myRank = me.rank;

  if (ranked.length === 1) return "You're #1 · No rivals yet";

  if (myRank === 1) {
    if (me.isTied) return "Tied for #1";
    if (me.tiebreaker === "streak") return "You're #1 · Leading by streak";
    if (me.tiebreaker === "time") return "You're #1 · Got there first";
    const lead = myPts - ranked[1].weekly_points;
    return `You're #1 · Leading by ${lead} pts`;
  }

  const ahead = ranked[myIndex - 1];
  const gap = ahead.weekly_points - myPts;

  if (gap === 0) {
    if (me.isTied) return `Tied for #${myRank}`;
    if (ahead.tiebreaker === "streak")
      return `You're #${myRank} · ${formatName(ahead.display_name, myRank - 1)} leads by streak`;
    if (ahead.tiebreaker === "time")
      return `You're #${myRank} · ${formatName(ahead.display_name, myRank - 1)} got there first`;
    return `Tied for #${myRank}`;
  }

  const aheadName = formatName(ahead.display_name, myRank - 1);
  return `You're #${myRank} · ${gap} pts behind ${aheadName}`;
}

// ─── Gap + today context line ──────────────────────────────────────────────────
// Secondary line beneath the status headline.
// Handles leading, tied-for-lead, behind, and tied-with-person-ahead cases.
// Returns null for solo packs with no today points (caller shows nothing).
// Accepts plain RankedEntry[] or pre-ranked RankedWithTiebreaker<>[] arrays.
export function buildGapLine(
  members: RankedEntry[],
  myUserId: string | undefined,
  todayPts: number,
): string | null {
  if (!myUserId || members.length === 0) return null;

  const ranked = (members[0] as RankedWithTiebreaker<RankedEntry>).rank !== undefined
    ? (members as RankedWithTiebreaker<RankedEntry>[])
    : rankWithTiebreakers(members);

  const myIndex = ranked.findIndex((r) => r.user_id === myUserId);
  if (myIndex < 0) return null;

  const me = ranked[myIndex];
  const todaySuffix = todayPts > 0 ? ` · +${todayPts} today` : " · no points yet";

  // Solo pack
  if (ranked.length === 1) return todayPts > 0 ? `+${todayPts} pts today` : null;

  if (me.rank === 1) {
    if (me.isTied) return `Tied for the lead${todaySuffix}`;
    if (me.tiebreaker === "streak") return `Ahead by streak${todaySuffix}`;
    if (me.tiebreaker === "time") return `Got there first${todaySuffix}`;
    const lead = me.weekly_points - ranked[1].weekly_points;
    if (lead === 0) return `Tied for the lead${todaySuffix}`;
    return `${lead} pt lead${todaySuffix}`;
  }

  const ahead = ranked[myIndex - 1];
  const gap = ahead.weekly_points - me.weekly_points;
  const aheadName = formatName(ahead.display_name, ahead.rank);

  if (gap === 0) {
    if (me.isTied) return `Tied with ${aheadName}${todaySuffix}`;
    if (ahead.tiebreaker === "streak") return `${aheadName} leads by streak${todaySuffix}`;
    if (ahead.tiebreaker === "time") return `${aheadName} got there first${todaySuffix}`;
    return `Tied with ${aheadName}${todaySuffix}`;
  }

  return `${gap} pts behind ${aheadName}${todaySuffix}`;
}

// ─── Urgency hint ─────────────────────────────────────────────────────────────
// Contextual nudge beneath the status line on Home cards.
// "One strong day could take the lead" only fires when the gap to #1 is
// within daily reach — not just the gap to the person immediately above.
export function buildUrgencyHint(
  ranked: RankedEntry[],
  myUserId: string | undefined,
  dailyMax: number,
  runEnd: string,
): string | null {
  // Time urgency wins over competitive messaging
  const now = new Date();
  const todayStr = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");

  if (runEnd === todayStr) {
    const msLeft =
      new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).getTime() -
      now.getTime();
    const hoursLeft = Math.floor(msLeft / (1000 * 60 * 60));
    return hoursLeft <= 8 ? `${hoursLeft}h left` : "Final day";
  }

  if (!myUserId || ranked.length < 2) return null;
  const myIndex = ranked.findIndex((r) => r.user_id === myUserId);
  if (myIndex < 0) return null;

  const myPts = ranked[myIndex].weekly_points;

  if (myIndex === 0) {
    const lead = myPts - ranked[1].weekly_points;
    if (lead > 0 && lead <= dailyMax) {
      return `${formatName(ranked[1].display_name, 2)} can still catch up`;
    }
    return null;
  }

  const gapToFirst = ranked[0].weekly_points - myPts;
  const gapToAhead = ranked[myIndex - 1].weekly_points - myPts;

  // "take the lead" only when gap to #1 is closeable — not just the adjacent gap
  if (gapToFirst > 0 && gapToFirst <= dailyMax) {
    return "One strong day could take the lead";
  }
  if (gapToAhead > 0 && gapToAhead <= dailyMax) {
    // Can advance a rank but cannot reach #1
    return "One strong day could move you up";
  }

  return null;
}

// ─── Gain consequence text ────────────────────────────────────────────────────
// Returns a formatted action string describing what earning `gain` pts achieves.
// Compares gain against BOTH gapToFirst and gapToAhead so "take the lead" is
// never shown when the gain would only advance a rank without reaching #1.
// Returns null when gain cannot close either gap — caller uses a generic fallback.
export function gainConsequenceText(
  gain: number,
  gapToAhead: number,
  gapToFirst: number,
  aheadName: string,
  activityLabel: string,
): string | null {
  // Check gapToFirst before gapToAhead — when myRank===2 they are equal and
  // the "take the lead" / "tie for #1" outcomes are preferred over "pass X".
  if (gain > gapToFirst) return `${activityLabel} to take the lead`;
  if (gain === gapToFirst) return `${activityLabel} to tie for #1`;
  if (gain > gapToAhead) return `${activityLabel} to pass ${aheadName}`;
  if (gain === gapToAhead) return `${activityLabel} to tie ${aheadName}`;
  return null;
}
