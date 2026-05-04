import * as Sentry from "@sentry/react-native";

let _initialized = false;

// Init guard: no-op if DSN unset (lets the code ship before .env is finalized
// without exploding). Idempotent — repeat calls are silent no-ops.
export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn || _initialized) return;

  Sentry.init({
    dsn,
    enabled: !__DEV__,
    debug: false,
    // Errors only for v1 — performance monitoring intentionally off.
    // Free-tier transaction quota (10K/mo) is reserved for when "what's
    // slow" becomes a focused question. Flip to 0.1 then.
    tracesSampleRate: 0,
    beforeSend(event, hint) {
      const err = hint?.originalException;
      const msg = err instanceof Error ? err.message : String(err ?? "");

      // Network-offline state: not a bug. Pack should keep working offline-ish
      // (cached state, failed mutations retry); these errors flood otherwise.
      if (/network request failed|aborterror/i.test(msg)) return null;

      // kingstinct HealthKit observer teardown is intentionally swallowed at
      // app/_layout.tsx:121-124 ("defensive — kingstinct may already have
      // torn down"). If one slips through to Sentry, it's the same noise.
      if (/kingstinct|HKObserver/i.test(msg)) return null;

      return event;
    },
  });

  _initialized = true;
}

// Attach the Supabase user UUID to every report so a crash can be traced to
// a specific account for follow-up. UUID only — no email, no display_name,
// no PII. Pass null on sign-out to clear.
export function setSentryUser(userId: string | null): void {
  if (!_initialized) return;
  Sentry.setUser(userId ? { id: userId } : null);
}

// Re-export the wrapper so callers don't need to import from @sentry/* directly.
export const wrap = Sentry.wrap;
