// Competition ranking helper for the Pack screen's PastRunsSection.
// Only rankWithTiebreakers remains here — the points-era copy builders
// (buildRankStatus / buildUrgencyHint) were deleted once the categories
// pivot removed their consumers.
// NOTE: rankWithTiebreakers and the types below are still points-based
// (weekly_points). 3f rewrites PastRunsSection and resolves this.

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
