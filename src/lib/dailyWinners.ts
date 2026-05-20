import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { packToday } from "./packDates";

// Throttle: the RPC fires on every Home focus per pack, but the work is
// idempotent and only needs to run once per pack per day. The key stores
// the last pack-local date the RPC was successfully run for.
const THROTTLE_KEY_PREFIX = "pack:dw_last_computed:";

export async function computeDailyWinnersForPack(
  packId: string,
  packTimezone: string,
): Promise<void> {
  const today = packToday(packTimezone);
  const key = THROTTLE_KEY_PREFIX + packId;
  try {
    const last = await AsyncStorage.getItem(key);
    if (last === today) return;
  } catch {
    // AsyncStorage read failure — proceed without throttle (fail-open)
  }
  const { error } = await supabase.rpc("compute_daily_winners_for_pack", {
    p_pack_id: packId,
  });
  if (error) {
    console.warn("[dailyWinners] compute failed:", error.message);
    return;
  }
  try {
    await AsyncStorage.setItem(key, today);
  } catch {
    // Best-effort persist; failure here just means we'll re-run next focus
  }
}
