import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

/**
 * Guarantees a public.users row exists for the given auth user.
 * Safe to call multiple times — uses ON CONFLICT DO NOTHING so it never
 * overwrites an existing display_name.
 *
 * Name resolution order:
 *   1. Supabase auth user_metadata.display_name  (written at sign-up)
 *   2. Email prefix  (e.g. "jordan" from "jordan@example.com")
 *   3. "Member"  (last resort — at least the row exists)
 */
export async function ensureUserProfile(
  userId: string,
  knownUser?: User | null,
): Promise<void> {
  try {
    let authUser = knownUser ?? null;
    if (!authUser) {
      const { data } = await supabase.auth.getUser();
      authUser = data.user;
    }

    const metaName = authUser?.user_metadata?.display_name as
      | string
      | undefined;
    const emailPrefix = authUser?.email?.split("@")[0];
    const display_name = metaName?.trim() || emailPrefix || "Member";

    const { error } = await supabase.from("users").upsert(
      {
        id: userId,
        display_name,
        healthkit_authorized: false,
        subscription_tier: "free",
      },
      { onConflict: "id", ignoreDuplicates: true },
    );

    if (error) {
      console.error("[ensureUserProfile] upsert failed:", error);
    }
  } catch (err) {
    console.error("[ensureUserProfile] unexpected error:", err);
  }
}
