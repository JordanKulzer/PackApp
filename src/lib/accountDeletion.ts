import { supabase } from "./supabase";
import { analytics, flushAnalytics, reset as resetAnalytics } from "./analytics";
import { logOutRevenueCat, isPro } from "./revenuecat";

// Edge Functions on Supabase have a 60s wall-clock timeout. We surface a
// friendly message at this threshold rather than letting the network call
// hang indefinitely. The Edge Function may continue running server-side
// after this — the audit log row captures intent and the explicit deletes
// in delete_user_cascade are idempotent, so a retry is safe.
const EDGE_FUNCTION_TIMEOUT_MS = 60_000;

export interface DeleteAccountInput {
  reason: string | null;
}

export interface DeleteAccountResult {
  ok: boolean;
  error?: string;
  errorKind?: "timeout" | "server" | "network" | "unauthenticated";
}

// Race a promise against a timeout. If the timeout fires first, the original
// promise keeps running but its resolution is ignored.
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<{ ok: true; value: T } | { ok: false; reason: "timeout" }> {
  return Promise.race<{ ok: true; value: T } | { ok: false; reason: "timeout" }>([
    promise.then((value) => ({ ok: true as const, value })),
    new Promise((resolve) =>
      setTimeout(() => resolve({ ok: false as const, reason: "timeout" }), ms),
    ),
  ]);
}

// Orchestrates the full deletion sequence per Pass 10a Section A:
//   1. Capture properties from live state (pre-destruction)
//   2. Fire account_deleted with reason
//   3. Flush PostHog (guarantee event ships before destruction)
//   4. Invoke delete-user Edge Function (transaction-wrapped server-side)
//   5. On success: RevenueCat logout, analytics reset, signOut, return ok
//   6. On error: surface friendly message, leave session intact for retry
//
// The account_deleted event fires BEFORE the Edge Function call. If deletion
// fails, the event has technically misfired — but capturing intent is the
// lesser evil vs. losing the funnel signal entirely. On retry, do NOT
// re-fire the event (the audit log row already exists server-side too).
export async function deleteAccount(
  input: DeleteAccountInput,
): Promise<DeleteAccountResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  const user = session?.user;
  if (!user) {
    return {
      ok: false,
      errorKind: "unauthenticated",
      error: "Not signed in",
    };
  }

  const userId = user.id;
  const createdAt = user.created_at;

  // ── Step 1: Capture properties from live data ───────────────────────────
  const daysSinceSignup = createdAt
    ? Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000))
    : 0;

  const [packCountRes, lastActiveRes, isProResult] = await Promise.all([
    supabase
      .from("pack_members")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_active", true),
    supabase
      .from("daily_scores")
      .select("updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    isPro().catch(() => false),
  ]);

  const packCount = packCountRes.count ?? 0;
  const lastActiveAt = lastActiveRes.data?.updated_at as string | undefined;
  const lastActiveDaysAgo = lastActiveAt
    ? Math.max(0, Math.floor((Date.now() - new Date(lastActiveAt).getTime()) / 86400000))
    : daysSinceSignup;

  // ── Step 2: Fire analytics event PRE-destruction ────────────────────────
  analytics.accountDeleted({
    days_since_signup: daysSinceSignup,
    pack_count_at_deletion: packCount,
    had_pro_subscription: isProResult,
    last_active_at_days_ago: lastActiveDaysAgo,
    deletion_reason: input.reason,
  });

  // ── Step 3: Flush — guarantee event ships before destruction ────────────
  await flushAnalytics();

  // ── Step 4: Invoke the Edge Function with timeout ───────────────────────
  const invokeResult = await withTimeout(
    supabase.functions.invoke("delete-user", { body: { reason: input.reason } }),
    EDGE_FUNCTION_TIMEOUT_MS,
  );

  if (!invokeResult.ok) {
    return {
      ok: false,
      errorKind: "timeout",
      error:
        "Deletion is taking longer than expected. Your data is being removed — try again in a few minutes.",
    };
  }

  const { error: invokeError } = invokeResult.value;
  if (invokeError) {
    return {
      ok: false,
      errorKind: "server",
      error: invokeError.message ?? "Couldn't delete your account. Try again or contact support.",
    };
  }

  // ── Step 5: Local cleanup ───────────────────────────────────────────────
  // RevenueCat: reset client identity. Subscription continues at Apple/Play
  // until separately canceled — copy in the confirmation UI explains this.
  try {
    await logOutRevenueCat();
  } catch (err) {
    console.error("[accountDeletion] RevenueCat logOut failed:", err);
  }

  // PostHog: reset distinct ID so a re-signup gets a fresh identity.
  resetAnalytics();

  // Supabase signOut. The server session is already invalid (auth.users is
  // deleted), but local state needs clearing. If signOut throws (e.g.,
  // because the access token is now rejected), force-clear via setSession.
  try {
    await supabase.auth.signOut();
  } catch (err) {
    console.error("[accountDeletion] signOut failed, force-clearing session:", err);
    try {
      await supabase.auth.setSession({
        access_token: "",
        refresh_token: "",
      });
    } catch {
      // best-effort — local session may be in an unrecoverable state, but
      // navigation to sign-in below will trigger a fresh auth flow anyway
    }
  }

  return { ok: true };
}
