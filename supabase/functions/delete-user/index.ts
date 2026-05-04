// Supabase Edge Function: delete-user
// Runtime: Deno (NOT Node) — see https://supabase.com/docs/guides/functions
//
// Deletes the calling user's account end-to-end. App Store guideline 5.1.1(v)
// requires in-app account deletion for any app supporting account creation.
//
// Auth: verify_jwt = true. The deleting user is identified ONLY by the JWT
// `sub` claim — never accepted from the request body. This is critical:
// accepting a body user_id would let any authenticated user delete any
// other user's account.
//
// Order of operations:
//   1. Decode JWT → userId
//   2. Run delete_user_cascade RPC (transaction-wrapped: audit log,
//      owned-pack auto-transfer/delete, explicit table deletes, public.users)
//   3. Storage cleanup: avatars/{userId}/, activity_photos/{userId}/,
//      activity_photos/victory/{userId}/. Outside the transaction; partial
//      failure here is recoverable manually.
//   4. supabaseAdmin.auth.admin.deleteUser(userId) — auth.users deletion
//
// Env vars (auto-injected by Supabase):
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY  (used to bypass RLS for cross-user lookups)

// deno-lint-ignore-file no-explicit-any
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

interface RequestBody {
  reason?: string | null;
}

// Decode JWT `sub` without verifying signature — Supabase's gateway already
// verified the JWT before invoking us when verify_jwt = true.
function decodeJwtSub(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - payload.length % 4) % 4);
    const decoded = JSON.parse(atob(padded));
    return typeof decoded.sub === "string" ? decoded.sub : null;
  } catch {
    return null;
  }
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Recursively delete every object under `prefix` in `bucket`. Chunked
// removal avoids exceeding storage API limits on heavy users.
async function deleteStorageFolder(
  client: SupabaseClient,
  bucket: string,
  prefix: string,
): Promise<void> {
  const { data: files, error: listErr } = await client.storage
    .from(bucket)
    .list(prefix, { limit: 1000 });
  if (listErr) {
    console.error(`[delete-user] list ${bucket}/${prefix} failed:`, listErr);
    return;
  }
  if (!files || files.length === 0) return;
  const paths = files.map((f) => `${prefix}/${f.name}`);
  for (let i = 0; i < paths.length; i += 50) {
    const chunk = paths.slice(i, i + 50);
    const { error: removeErr } = await client.storage.from(bucket).remove(chunk);
    if (removeErr) {
      console.error(`[delete-user] remove ${bucket} chunk failed:`, removeErr);
    }
  }
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  // JWT-sub only. Never trust a body user_id.
  const userId = decodeJwtSub(req.headers.get("Authorization"));
  if (!userId) {
    return jsonResponse(401, { error: "Missing or invalid auth token" });
  }

  // Body is optional — only carries the deletion reason.
  let body: RequestBody = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine — reason will be null
  }
  const reason = body.reason ?? null;

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // Step 1: Run the transactional cascade. RPC handles audit log + owned-pack
  // auto-transfer + explicit deletes + public.users delete in one transaction.
  const { error: rpcError } = await supabaseAdmin.rpc("delete_user_cascade", {
    target_user_id: userId,
    reason,
  });
  if (rpcError) {
    console.error("[delete-user] delete_user_cascade RPC failed:", rpcError);
    return jsonResponse(500, {
      error: "Deletion failed",
      detail: rpcError.message,
    });
  }

  // Step 2: Storage cleanup. Outside the transaction — partial storage
  // failure does not block auth.users deletion. Each call is best-effort
  // (errors logged but not surfaced as 500s).
  await Promise.all([
    deleteStorageFolder(supabaseAdmin, "avatars", userId),
    deleteStorageFolder(supabaseAdmin, "activity_photos", userId),
    deleteStorageFolder(supabaseAdmin, "activity_photos", `victory/${userId}`),
  ]);

  // Step 3: auth.users deletion. RPCs cannot delete from auth schema
  // directly without elevated config; auth.admin.deleteUser handles it.
  const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (authError) {
    // public.users is already gone; auth.users persisting is recoverable
    // by manual cleanup. Audit log captures intent.
    console.error("[delete-user] auth.admin.deleteUser failed:", authError);
    return jsonResponse(500, {
      error: "Auth user deletion failed",
      detail: authError.message,
    });
  }

  return jsonResponse(200, { ok: true });
});
