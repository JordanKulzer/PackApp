// Supabase Edge Function: notify-pack-event
// Runtime: Deno (NOT Node) — see https://supabase.com/docs/guides/functions
//
// Dispatches push notifications for all pack-related events. Replaces the
// per-client Expo push calls in src/lib/notifications.ts and
// src/lib/threatNotifications.ts so that delivery survives the actor
// backgrounding the app.
//
// Auth: verify_jwt = true in supabase/config.toml. The actor is the JWT subject;
// callers cannot spoof a different actor by setting a body field.
//
// Env vars (auto-injected by Supabase):
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY  (used to bypass RLS for cross-user lookups)
// Optional secret:
//   - EXPO_ACCESS_TOKEN          (for higher-tier Expo push rate limits)

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { push } from "../_shared/push-strings.ts";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// ─────────────────────────────────────────────────────────────────────────────
// Event types — discriminated union mirroring client copy in
// src/lib/notifications.ts and src/lib/threatNotifications.ts.
// ─────────────────────────────────────────────────────────────────────────────

type ActivityType = "steps" | "workout" | "calories" | "water";

type NotificationEvent =
  // Broadcast (no recipients[] required)
  | { kind: "goal"; activityType: ActivityType; pointsEarned: number }
  | { kind: "all_goals"; totalPoints: number }
  | { kind: "took_lead" }
  | { kind: "new_member"; newMemberName: string; packName: string }
  | { kind: "goals_updated"; nextRunStart: string }
  | { kind: "pack_renamed"; newName: string }
  // Targeted (recipients[] required)
  | { kind: "passed_you"; rankAfter: number }
  | { kind: "tied_you"; rankAfter: number }
  | { kind: "one_action_away"; actionLabel: string }
  | { kind: "new_comment"; bodyPreview: string }
  | { kind: "ownership_transferred"; newOwnerName: string };

interface RequestBody {
  packId: string;
  event: NotificationEvent;
  recipients?: string[];
}

const BROADCAST_KINDS = new Set([
  "goal",
  "all_goals",
  "took_lead",
  "new_member",
  "goals_updated",
  "pack_renamed",
]);

// ─────────────────────────────────────────────────────────────────────────────
// pref_key mapping (replaces the buggy ternary in src/lib/notifications.ts:51
// that always returned "goal_completed").
// ─────────────────────────────────────────────────────────────────────────────

function prefKeyForEvent(kind: NotificationEvent["kind"]): string {
  switch (kind) {
    case "goal":
    case "all_goals":
      return "goal_completed";
    case "took_lead":
    case "passed_you":
    case "tied_you":
    case "one_action_away":
      return "overtaken";
    case "new_member":
    case "ownership_transferred":
      return "new_member";
    case "new_comment":
      return "new_comment";
    case "goals_updated":
    case "pack_renamed":
      return "pack_settings_changed";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Date format — mirrors src/constants/strings.ts client-side formatting so
// the push body matches the chat system message verbatim. Empty input
// returns "" (defensive: old clients during the rollout window emit
// goals_updated without nextRunStart; the body becomes "Goals updated ·
// Applied " — ugly but non-crashing, self-heals as users update).
// ─────────────────────────────────────────────────────────────────────────────

function formatRunDate(isoDate: string): string {
  if (!isoDate) return "";
  const d = new Date(isoDate + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Copy — mirrors buildNotificationCopy in src/lib/notifications.ts and
// buildThreatCopy in src/lib/threatNotifications.ts.
// ─────────────────────────────────────────────────────────────────────────────

function buildCopy(
  actorName: string,
  event: NotificationEvent,
): { title: string; body: string } {
  switch (event.kind) {
    // TODO(7b): brand voice — currently uses generic competitive register.
    // See strings.ts push.* for wolf-voice patterns when authoring replacement.
    case "goal": {
      const label =
        event.activityType === "steps"    ? "their step goal" :
        event.activityType === "workout"  ? "a workout" :
        event.activityType === "calories" ? "their calorie goal" :
                                            "their water goal";
      return { title: actorName, body: `completed ${label} (+${event.pointsEarned} pts)` };
    }
    // TODO(7b): brand voice — currently uses generic register with 🔥 emoji.
    // See strings.ts push.* for wolf-voice patterns when authoring replacement.
    case "all_goals":
      return { title: actorName, body: `completed all goals today 🔥 (${event.totalPoints} pts)` };
    // TODO(7b): brand voice — currently uses generic competitive register
    // with 👑 emoji. See strings.ts push.* for wolf-voice patterns when
    // authoring replacement.
    case "took_lead":
      return { title: "👑 Lead Change", body: `${actorName} took the lead` };
    // TODO(7b): brand voice — currently uses generic competitive register
    // with 📉 emoji. See strings.ts push.* for wolf-voice patterns when
    // authoring replacement.
    case "passed_you":
      return { title: "📉 You Dropped", body: `${actorName} passed you — you're now #${event.rankAfter}` };
    // TODO(7b): brand voice — currently uses generic competitive register
    // with ⚡ emoji. See strings.ts push.* for wolf-voice patterns when
    // authoring replacement.
    case "tied_you":
      return { title: "⚡ Tied Up", body: `${actorName} tied you for #${event.rankAfter}` };
    // TODO(7b): brand voice — currently uses generic competitive register
    // with ⚠️ emoji. See strings.ts push.* for wolf-voice patterns when
    // authoring replacement.
    case "one_action_away":
      return { title: "⚠️ Closing In", body: `${actorName} is ${event.actionLabel} away from passing you` };
    // Migrated to push.newMemberJoined (Pass 7a). Currently scaffolded but
    // disconnected — no firing site exists yet. When join-ping wiring lands,
    // the brand voice is already in place.
    case "new_member":
      return push.newMemberJoined(event.newMemberName, event.packName);
    // TODO(7b): brand voice — currently uses generic register. See strings.ts
    // push.* for wolf-voice patterns when authoring replacement.
    case "new_comment":
      return { title: actorName, body: `commented: "${event.bodyPreview}"` };
    // TODO(7b): brand voice — currently uses generic register. See strings.ts
    // push.* for wolf-voice patterns when authoring replacement.
    case "ownership_transferred":
      return { title: "Pack ownership transferred", body: `${actorName} made ${event.newOwnerName} the new pack owner` };
    // TODO(voice review): refined copy for Pass 20e. Date interpolated from
    // event.nextRunStart so push body matches the chat system message verbatim.
    // Defensive empty fallback for old clients during the rollout window.
    case "goals_updated": {
      const date = formatRunDate(event.nextRunStart ?? "");
      return { title: "Pack goals updated", body: `Goals updated · Applied ${date}` };
    }
    // TODO(voice review): placeholder copy for Pass 20e.
    case "pack_renamed":
      return { title: "Pack renamed", body: `${actorName} renamed the pack to ${event.newName}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JWT — extract `sub` (actor user id) without verifying signature. Supabase's
// gateway already verified the JWT before invoking us when verify_jwt = true.
// ─────────────────────────────────────────────────────────────────────────────

function decodeJwtSub(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    // base64url → base64
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - payload.length % 4) % 4);
    const decoded = JSON.parse(atob(padded));
    return typeof decoded.sub === "string" ? decoded.sub : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  // Identify the actor from the JWT (verified by Supabase gateway).
  const actorId = decodeJwtSub(req.headers.get("Authorization"));
  if (!actorId) {
    return jsonResponse(401, { error: "Missing or invalid auth token" });
  }

  // Parse body
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const { packId, event, recipients } = body;
  if (!packId || !event || !event.kind) {
    return jsonResponse(400, { error: "Missing packId or event.kind" });
  }

  const isBroadcast = BROADCAST_KINDS.has(event.kind);
  if (!isBroadcast && (!recipients || recipients.length === 0)) {
    return jsonResponse(400, {
      error: `Event '${event.kind}' is targeted; 'recipients' array is required`,
    });
  }

  // Service-role admin client — bypasses RLS so we can read tokens and prefs
  // for users other than the actor.
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // Resolve recipient list
  let recipientIds: string[];
  if (isBroadcast) {
    const { data: members, error: membersErr } = await supabaseAdmin
      .from("pack_members")
      .select("user_id")
      .eq("pack_id", packId)
      .eq("is_active", true)
      .neq("user_id", actorId);
    if (membersErr) {
      return jsonResponse(500, { error: "Failed to load pack members", detail: membersErr.message });
    }
    recipientIds = (members ?? []).map((m: { user_id: string }) => m.user_id);
  } else {
    // Strip the actor in case the caller included them.
    recipientIds = (recipients ?? []).filter((id) => id !== actorId);
  }

  if (recipientIds.length === 0) {
    return jsonResponse(200, { sent: 0, skipped: 0, receipts: [], reason: "no recipients" });
  }

  // Fetch actor name
  const { data: actorRow } = await supabaseAdmin
    .from("users")
    .select("display_name")
    .eq("id", actorId)
    .maybeSingle();
  const actorName = actorRow?.display_name ?? "A pack member";

  // Fetch tokens + opt-outs in parallel
  const prefKey = prefKeyForEvent(event.kind);
  const [tokensRes, prefsRes] = await Promise.all([
    supabaseAdmin
      .from("user_push_tokens")
      .select("user_id, token")
      .in("user_id", recipientIds),
    supabaseAdmin
      .from("user_notification_prefs")
      .select("user_id")
      .in("user_id", recipientIds)
      .eq("pref_key", prefKey)
      .eq("enabled", false),
  ]);

  if (tokensRes.error) {
    return jsonResponse(500, { error: "Failed to load push tokens", detail: tokensRes.error.message });
  }
  if (prefsRes.error) {
    return jsonResponse(500, { error: "Failed to load notification prefs", detail: prefsRes.error.message });
  }

  const optedOut = new Set((prefsRes.data ?? []).map((r: { user_id: string }) => r.user_id));
  const tokensByUser: Record<string, string[]> = {};
  (tokensRes.data ?? []).forEach((row: { user_id: string; token: string }) => {
    if (!row.token || !row.token.startsWith("ExponentPushToken")) return;
    if (!tokensByUser[row.user_id]) tokensByUser[row.user_id] = [];
    tokensByUser[row.user_id].push(row.token);
  });

  // Build Expo push messages
  const { title, body: pushBody } = buildCopy(actorName, event);
  let skipped = 0;
  const messages: Array<{
    to: string;
    title: string;
    body: string;
    sound: "default";
    data: { packId: string; eventKind: string };
  }> = [];

  for (const uid of recipientIds) {
    if (optedOut.has(uid)) { skipped += 1; continue; }
    const tokens = tokensByUser[uid] ?? [];
    if (tokens.length === 0) { skipped += 1; continue; }
    for (const token of tokens) {
      messages.push({
        to: token,
        title,
        body: pushBody,
        sound: "default",
        data: { packId, eventKind: event.kind },
      });
    }
  }

  if (messages.length === 0) {
    return jsonResponse(200, { sent: 0, skipped, receipts: [], reason: "no deliverable tokens" });
  }

  // POST to Expo
  const expoHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "accept-encoding": "gzip, deflate",
  };
  const expoToken = Deno.env.get("EXPO_ACCESS_TOKEN");
  if (expoToken) expoHeaders["Authorization"] = `Bearer ${expoToken}`;

  let receipts: any[] = [];
  let expoErrors: any[] | undefined;
  try {
    const expoRes = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: expoHeaders,
      body: JSON.stringify(messages),
    });
    const expoJson = await expoRes.json().catch(() => ({}));
    if (Array.isArray(expoJson?.data)) receipts = expoJson.data;
    if (Array.isArray(expoJson?.errors) && expoJson.errors.length > 0) expoErrors = expoJson.errors;
    if (!expoRes.ok && !expoErrors) {
      expoErrors = [{ status: expoRes.status, body: expoJson }];
    }
  } catch (err) {
    return jsonResponse(502, {
      error: "Expo push request failed",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  return jsonResponse(200, {
    sent: receipts.length,
    skipped,
    receipts,
    ...(expoErrors ? { errors: expoErrors } : {}),
  });
});
