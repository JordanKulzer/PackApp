/**
 * Display name normalization + UI formatting.
 *
 * Two-layer design (Pass 15):
 *  - Write-time:  normalizeDisplayName() applied at every site that writes
 *                 users.display_name (sign-up, profile-setup, profile-edit,
 *                 social-signup fallback). New users always land canonical.
 *  - Render-time: formatName() applies normalizeDisplayName() so existing
 *                 inconsistent rows render consistently without touching the DB.
 *                 No destructive backfill needed; data self-heals as users
 *                 edit their profiles.
 *
 * Heuristic: capitalize the first letter of each whitespace-separated word,
 * but ONLY when that first letter is lowercase. Preserves intentional
 * all-caps ("KAREN") and branded mid-string capitalization ("McDonald",
 * "iPhone" — both rare in display names but user intent should win where
 * we can detect it).
 *
 * Known limitations:
 *   - "o'brien" → "O'brien" (not "O'Brien"). Apostrophe-internal capitalization
 *     would need lookup tables; not worth it for v1.
 *   - "iPhone" → "IPhone" if the user typed it lowercase-i originally and we
 *     misread the intent. Rare in display names.
 */

export function normalizeDisplayName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed
    .split(/(\s+)/) // preserve internal whitespace shape
    .map((token) => {
      if (token.length === 0 || /^\s+$/.test(token)) return token;
      const first = token.charAt(0);
      const lower = first.toLocaleLowerCase();
      const upper = first.toLocaleUpperCase();
      // Only capitalize when the first char is currently lowercase AND has a
      // distinct uppercase form (i.e., it's a cased letter — skips digits,
      // punctuation, and Chinese/Japanese/Korean which have no case concept).
      if (first === lower && lower !== upper) {
        return upper + token.slice(1);
      }
      return token;
    })
    .join("");
}

/**
 * Formats a raw display_name from the database into a UI-safe string.
 * Never returns "Unknown". Falls back to "Player N" when a rank is available,
 * or "Member" when it is not.
 */
export function formatName(
  raw: string | null | undefined,
  rank?: number,
): string {
  const name = normalizeDisplayName(raw ?? "");
  if (name && name !== "Unknown") return name;
  if (rank !== undefined) return `Player ${rank}`;
  return "Member";
}

/**
 * Returns a single uppercase character to use as an avatar initial.
 * Handles null/undefined, empty strings, and whitespace-only input
 * with a "?" fallback. No smart logic for emojis, multi-word names,
 * or non-Latin scripts — just first-char + toUpperCase. Sufficient
 * for all current call sites; expand later if a smarter variant is
 * needed.
 */
export function getInitial(name: string | null | undefined): string {
  if (!name) return "?";
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed.charAt(0).toUpperCase();
}
