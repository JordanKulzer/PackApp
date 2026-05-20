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

    // Dense rank by weekly_points only — same points = same rank regardless of streak/time.
    const tiedWithPrevByPoints = !!prevRaw && prevRaw.weekly_points === member.weekly_points;
    const rank = tiedWithPrevByPoints ? prevResult!.rank : i + 1;

    // Why am I positioned before the next same-pts person? (streak/time determines display order)
    let tiebreaker: TiebreakerReason = null;
    if (next && next.weekly_points === member.weekly_points) {
      const ms = member.streak_days ?? 0, ns = next.streak_days ?? 0;
      if (ms > ns) tiebreaker = "streak";
      else if (ms === ns) {
        const mt = member.updated_at ?? null, nt = next.updated_at ?? null;
        if (mt !== nt) tiebreaker = "time";
      }
    }

    const tiedWithNextByPoints = !!next && next.weekly_points === member.weekly_points;
    result.push({ ...member, rank, tiebreaker, isTied: tiedWithPrevByPoints || tiedWithNextByPoints });
  }

  return result;
}

// ─── Rank status headline ──────────────────────────────────────────────────────
// Returns the primary status string with correct tie detection.
// Tie counting is by points only — members sharing the user's weekly_points form
// the tie group. Ranks come from rankWithTiebreakers which assigns competition
// ranks (1, 1, 3) so #1 badges on avatars stay consistent with this copy.
// "You're #1 · Leading by 20 pts" / "You're tied for #1 with 2 others" /
// "You're tied for #3 · 15 pts behind" / "You're #3 · 5 pts behind" / "You're #1"
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

  if (ranked.length === 1) return "You're #1";

  // Everyone at 0 — skip the "leading by" framing entirely.
  if (ranked.every((r) => r.weekly_points === 0)) {
    return "You're tied for #1 — no points yet";
  }

  // Tie group = members sharing my exact points total (including me).
  const tiedCount = ranked.filter((r) => r.weekly_points === myPts).length;

  if (tiedCount > 1) {
    if (myRank === 1) {
      const others = tiedCount - 1;
      return `You're tied for #1 with ${others} other${others > 1 ? "s" : ""}`;
    }
    const pointsBehindLeader = ranked[0].weekly_points - myPts;
    return `You're tied for #${myRank} · ${pointsBehindLeader} pts behind`;
  }

  if (myRank === 1) {
    const lead = myPts - ranked[1].weekly_points;
    if (lead > 0) return `You're #1 · Leading by ${lead} pts`;
    return "You're #1";
  }

  const gap = ranked[myIndex - 1].weekly_points - myPts;
  return `You're #${myRank} · ${gap} pts behind`;
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
