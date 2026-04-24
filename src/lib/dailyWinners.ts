import { supabase } from "./supabase";

export async function computeDailyWinnersForPack(packId: string): Promise<void> {
  const { error } = await supabase.rpc("compute_daily_winners_for_pack", { p_pack_id: packId });
  if (error) console.warn("[dailyWinners] compute failed:", error.message);
}
