import { supabase } from "./supabase";
import { deviceLocalToday } from "./packDates";
import { computeUserStreak } from "./computeUserStreak";

// ─────────────────────────────────────────────────────────────────────────────
// Check-in today (Stage 3 of the streak rewrite).
//
// Idempotent UPSERT into daily_checkins for (user_id, deviceLocalToday()) —
// the PK on those two columns makes a re-tap a harmless no-op (conflict
// path leaves checked_in_at on its original DEFAULT now() value; the row
// already exists, the user already satisfied today). Then recomputes the
// per-user GLOBAL streak so users.current_streak / best_streak /
// last_streak_date reflect the new state.
//
// Mirrors syncWater.ts's small-lib shape: errors are logged + the function
// returns quietly rather than throwing. Caller (LogSheet's handleCheckIn)
// guards optimistic UI on its own.
// ─────────────────────────────────────────────────────────────────────────────

export async function checkInToday(userId: string): Promise<void> {
  const today = deviceLocalToday();

  const { error } = await supabase
    .from("daily_checkins")
    .upsert(
      // checked_in_at omitted — the column's DEFAULT now() handles INSERT;
      // re-tap on the same day is an UPDATE-noop (conflict path doesn't
      // touch checked_in_at, which is what we want for "harmless re-tap").
      { user_id: userId, score_date: today },
      { onConflict: "user_id,score_date" },
    );

  if (error) {
    console.error("[checkInToday] daily_checkins upsert error:", error);
    return;
  }

  // Stage 2 streak recompute. Awaited so a successful resolve here means
  // users.current_streak reflects the new check-in. computeUserStreak
  // catches its own errors internally — it never throws.
  await computeUserStreak(userId);
}
