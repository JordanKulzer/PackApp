// Member identity palette + a position-independent stable color
// assignment shared by every surface that shows member identity
// (Compete bars/dots/rings, Home mini-rings). Keying by SORTED user_id
// (not display-rank position) guarantees a given user gets the same
// color on every surface and across category-tab / sort changes — the
// color is an IDENTITY signal, so it must not shift when standings move.
//
// Excludes the reserved gold (leader) / blue (self) / accent hues so a
// member's palette color never collides with those standing/self
// signals. These are the same 8 from Compete's prior ALL_MODE_PALETTE
// (greens / violets / magentas / red — chosen to be unambiguously not
// gold under the dim chart background; see PackCompeteView's prior
// comments for the swap rationale).
export const MEMBER_PALETTE = [
  "#22C55E", // green
  "#7F77DD", // blue-violet
  "#D4537E", // magenta
  "#1D9E75", // teal-green
  "#5DCAA5", // mint
  "#5AA9E6", // sky (distinct from self-blue)
  "#C77DFF", // lavender
  "#E2484A", // red
] as const;

// Position-independent stable color. Sort the pack's user ids
// lexicographically and assign by sorted index. Same id SET in → same
// color per user out, on every surface.
//
// The CALLER is responsible for passing the SAME set of user ids on
// every surface (the pack's full active-member roster). If one surface
// passes a filtered subset or a different roster snapshot, colors will
// diverge across surfaces — the helper alone can't enforce that.
//
// Missing-id fallback (idx < 0) returns the first palette slot. This
// shouldn't happen in practice — callers should only ask about ids
// they included in allUserIds — but it's a safe default rather than a
// throw on a transient roster-mutation race.
export function stableColorForUser(
  userId: string,
  allUserIds: string[],
): string {
  const sorted = [...allUserIds].sort();
  const idx = sorted.indexOf(userId);
  if (idx < 0) return MEMBER_PALETTE[0];
  return MEMBER_PALETTE[idx % MEMBER_PALETTE.length];
}
