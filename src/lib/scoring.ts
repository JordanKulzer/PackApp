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

// Point values — single source of truth for scoring logic
export const POINTS = {
  steps: 10,
  workout: 15,
  calories: 10,
  water: 8,
} as const;

// Maximum workouts credited per user per day
export const WORKOUT_MAX_DAILY = 2;

// Points for N workouts in a day (pre-multiplier)
export function workoutPoints(count: number): number {
  return Math.min(count, WORKOUT_MAX_DAILY) * POINTS.workout;
}

// Streak multiplier thresholds
export function getStreakMultiplier(streakDays: number): number {
  if (streakDays >= 7) return 2.0;
  if (streakDays >= 5) return 1.5;
  if (streakDays >= 3) return 1.25;
  return 1.0;
}

// Calculate points for a single activity with streak multiplier applied
export function calculatePoints(
  activityType: keyof typeof POINTS,
  streakDays: number,
): number {
  const base = POINTS[activityType];
  const multiplier = getStreakMultiplier(streakDays);
  return Math.round(base * multiplier);
}

// Calculate total points from daily achievements
export function calculateDailyTotal(
  achievements: {
    steps_achieved: boolean;
    workout_achieved: boolean;
    calories_achieved: boolean;
    water_achieved: boolean;
  },
  streakDays: number,
): number {
  const multiplier = getStreakMultiplier(streakDays);
  let total = 0;
  if (achievements.steps_achieved) total += POINTS.steps;
  if (achievements.workout_achieved) total += POINTS.workout;
  if (achievements.calories_achieved) total += POINTS.calories;
  if (achievements.water_achieved) total += POINTS.water;
  return Math.round(total * multiplier);
}
