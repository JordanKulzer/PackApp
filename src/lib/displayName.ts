/**
 * Formats a raw display_name from the database into a UI-safe string.
 * Never returns "Unknown". Falls back to "Player N" when a rank is available,
 * or "Member" when it is not.
 */
export function formatName(
  raw: string | null | undefined,
  rank?: number,
): string {
  const name = (raw ?? "").trim();
  if (name && name !== "Unknown") return name;
  if (rank !== undefined) return `Player ${rank}`;
  return "Member";
}
