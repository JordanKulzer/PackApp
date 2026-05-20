export function getTimeUntilReset(): {
  days: number;
  hours: number;
  minutes: number;
  label: string;
} {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun … 6=Sat
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;

  const nextSunday = new Date(now);
  nextSunday.setDate(now.getDate() + daysUntilSunday);
  nextSunday.setHours(23, 59, 59, 0);

  const msRemaining = nextSunday.getTime() - now.getTime();
  if (msRemaining <= 0) {
    return { days: 0, hours: 0, minutes: 0, label: "Resetting…" };
  }

  const totalMinutes = Math.floor(msRemaining / 60_000);
  const totalHours = Math.floor(msRemaining / 3_600_000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = totalMinutes % 60;

  let label: string;
  if (totalMinutes < 60) {
    label = `Resets in ${totalMinutes}m`;
  } else if (totalHours < 12) {
    label = "Resets tonight";
  } else {
    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    label = `Resets in ${parts.join(" ")}`;
  }

  return { days, hours, minutes, label };
}

// Maximum workouts credited per user per day — semantic limit on workout
// counting. Retained after the Categories pivot (Stage 2A) removed the
// POINTS table, streak multipliers, and the points-calculation helpers.
export const WORKOUT_MAX_DAILY = 2;
