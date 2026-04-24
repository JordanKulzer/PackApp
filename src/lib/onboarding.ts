import { supabase } from "./supabase";

export async function completeOnboarding(userId: string): Promise<{ error: Error | null }> {
  const { error } = await supabase
    .from("users")
    .update({ has_completed_onboarding: true })
    .eq("id", userId);
  return { error: error as Error | null };
}
