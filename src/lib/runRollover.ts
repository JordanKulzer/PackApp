import { supabase } from "./supabase";

/**
 * Calls the server-side rollover RPC, which atomically closes expired runs
 * and opens new ones for the current Mon-Sun week (in each pack's timezone).
 * Safe to call on every app foreground.
 */
export async function rolloverExpiredRuns(userId: string): Promise<void> {
  const { data, error } = await supabase.rpc("rollover_expired_runs", {
    caller_user_id: userId,
  });

  if (error) {
    console.error("[runRollover] RPC error:", error);
    return;
  }

  if (data && data.length > 0) {
    console.log("[runRollover] rolled over:", data);
  }
}
