// All date math involving a pack MUST go through this module.
// Never call `new Date().toISOString().split("T")[0]` directly — use packToday().

/**
 * Returns "today" in the pack's timezone as a YYYY-MM-DD string.
 */
export function packToday(packTimezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: packTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

/**
 * Returns "yesterday" in the pack's timezone as a YYYY-MM-DD string.
 */
export function packYesterday(packTimezone: string): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: packTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d);
}

/**
 * Returns the Sunday of the current week in pack timezone as YYYY-MM-DD.
 * Weeks run Sunday → Saturday.
 * E.g., Wed Apr 22 2026 in America/Chicago → "2026-04-19".
 */
export function weekStartInPackTz(packTimezone: string): string {
  const todayStr = packToday(packTimezone);
  const [yyyy, mm, dd] = todayStr.split("-").map(Number);
  const utcDate = new Date(Date.UTC(yyyy, mm - 1, dd));
  const dow = utcDate.getUTCDay(); // 0=Sun … 6=Sat
  const daysSinceSunday = dow; // Sunday is already 0, no offset needed
  utcDate.setUTCDate(utcDate.getUTCDate() - daysSinceSunday);
  return utcDate.toISOString().split("T")[0];
}

/**
 * Returns the Saturday of the current week in pack timezone as YYYY-MM-DD.
 * Weeks run Sunday → Saturday.
 * E.g., Wed Apr 22 2026 in America/Chicago → "2026-04-25".
 */
export function weekEndInPackTz(packTimezone: string): string {
  const start = weekStartInPackTz(packTimezone);
  const [yyyy, mm, dd] = start.split("-").map(Number);
  const utcDate = new Date(Date.UTC(yyyy, mm - 1, dd));
  utcDate.setUTCDate(utcDate.getUTCDate() + 6); // Sunday + 6 = Saturday
  return utcDate.toISOString().split("T")[0];
}

/**
 * Returns true if end_date (YYYY-MM-DD) is strictly before today in the pack's timezone.
 * Used to decide whether a run needs to roll over.
 */
export function isRunExpired(endDate: string, packTimezone: string): boolean {
  return endDate < packToday(packTimezone);
}

/**
 * For a pack being created today, the first run ends on the Sunday of the current
 * week in the pack's timezone (partial first week).
 */
export function firstRunEndDate(packTimezone: string): string {
  return weekEndInPackTz(packTimezone);
}

/**
 * Returns the next full Sun-Sat week's start and end, given the previous run's end date.
 * The day after previousEndDate must be a Sunday (Saturday + 1 = Sunday).
 */
export function nextRunDates(previousEndDate: string): { start: string; end: string } {
  const [yyyy, mm, dd] = previousEndDate.split("-").map(Number);
  const utcDate = new Date(Date.UTC(yyyy, mm - 1, dd));
  utcDate.setUTCDate(utcDate.getUTCDate() + 1); // Sunday → Monday
  const start = utcDate.toISOString().split("T")[0];
  utcDate.setUTCDate(utcDate.getUTCDate() + 6); // Monday → Sunday
  const end = utcDate.toISOString().split("T")[0];
  return { start, end };
}

/**
 * Returns the UTC Date that corresponds to midnight of "today" in the pack's timezone.
 * Used for `gte("created_at", ...)` queries on activity_feed to scope feed events
 * to "today in pack timezone" rather than "today in UTC".
 *
 * Implementation: derives the pack's UTC offset from Intl by comparing the pack-timezone
 * clock reading to the actual UTC timestamp, then shifts UTC midnight by that offset.
 */
export function packTodayStartUTC(packTimezone: string): Date {
  const now = new Date();
  // Build the "now" time components as they appear in the pack's timezone
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: packTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (t: string) => parseInt(parts.find((p) => p.type === t)!.value, 10);
  const tzH = get("hour") % 24; // some impls return 24 for midnight
  const tzMs = Date.UTC(get("year"), get("month") - 1, get("day"), tzH, get("minute"), get("second"));
  const offsetMs = tzMs - now.getTime(); // positive = UTC+, negative = UTC-

  const today = packToday(packTimezone);
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMs);
}

/**
 * Returns which calendar day of the run we're on (1-indexed, clamped to [1, total]).
 * Fixes two bugs in the old inline version:
 *   1. Bare YYYY-MM-DD strings parsed as UTC midnight caused off-by-one for UTC- zones.
 *   2. end - start (ms) gives 6 for a 7-day week; +1 makes it inclusive.
 */
export function currentDayOfRun(
  run: { start_date: string; end_date: string },
  packTimezone: string,
): { day: number; total: number } {
  const today = packToday(packTimezone);
  const msPerDay = 1000 * 60 * 60 * 24;
  // Parse at noon local to avoid UTC-midnight shifts across timezones.
  const startMs = new Date(run.start_date + "T12:00:00").getTime();
  const endMs = new Date(run.end_date + "T12:00:00").getTime();
  const todayMs = new Date(today + "T12:00:00").getTime();
  const total = Math.round((endMs - startMs) / msPerDay) + 1;
  const elapsed = Math.round((todayMs - startMs) / msPerDay);
  return { day: Math.min(Math.max(1, elapsed + 1), total), total };
}

/**
 * Returns the device's IANA timezone string (e.g., "America/Chicago").
 * Used when creating a pack — the creator's timezone becomes the pack's timezone.
 */
export function getDeviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
