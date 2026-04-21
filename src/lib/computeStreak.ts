import { supabase } from "./supabase";

// Computes streak_days for a user within a specific run, counting backward
// from yesterday to find consecutive days where any goal was achieved.
// Returns the streak INCLUDING today if anyAchievedToday is true.
// Extracted from healthkit.ts so manual log paths can use the same logic.
export async function computeStreakForRun(
  userId: string,
  runId: string,
  today: string,
  anyAchievedToday: boolean,
): Promise<number> {
  const { data: pastScores } = await supabase
    .from("daily_scores")
    .select("score_date, steps_achieved, workout_achieved, calories_achieved, water_achieved")
    .eq("run_id", runId)
    .eq("user_id", userId)
    .lt("score_date", today)
    .order("score_date", { ascending: false });

  let streakDays = 0;
  if (pastScores && pastScores.length > 0) {
    const cursor = new Date();
    cursor.setDate(cursor.getDate() - 1); // start from yesterday

    for (const row of pastScores) {
      const expected = cursor.toISOString().split("T")[0];
      if (row.score_date !== expected) break;
      const anyHit =
        row.steps_achieved ||
        row.workout_achieved ||
        row.calories_achieved ||
        row.water_achieved;
      if (!anyHit) break;
      streakDays++;
      cursor.setDate(cursor.getDate() - 1);
    }
  }

  if (anyAchievedToday) streakDays += 1;
  return streakDays;
}
