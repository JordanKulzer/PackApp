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

/**
 * Returns the UTC Date range covering a given YYYY-MM-DD date in the pack's timezone.
 * Used by multi-day HealthKit backfill — each per-day HK query needs to scope to
 * the day's bounds in pack-tz, not device-local UTC.
 *
 * DST-correct: derives the offset from the target date itself (not "now"), so a
 * backfill window that straddles a spring-forward or fall-back boundary still
 * resolves each day's bounds correctly.
 */
export function packDateRangeUTC(
  date: string,
  packTimezone: string,
): { start: Date; end: Date } {
  const [y, m, d] = date.split("-").map(Number);
  const candidateUTC = Date.UTC(y, m - 1, d, 0, 0, 0);

  // Read the candidate UTC midnight back through the pack's timezone. The
  // delta between what we get and what we sent is the tz offset on that date.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: packTimezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(candidateUTC));

  const get = (t: string) => parseInt(parts.find((p) => p.type === t)!.value, 10);
  const tzH = get("hour") % 24; // some Intl impls return 24 for midnight
  const tzMs = Date.UTC(get("year"), get("month") - 1, get("day"), tzH, get("minute"), get("second"));
  const offsetMs = tzMs - candidateUTC;

  const start = new Date(candidateUTC - offsetMs);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}
