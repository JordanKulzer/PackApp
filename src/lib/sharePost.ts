// Intentional-sharing Phase 2 — the Share-composer emit helper.
//
// Mirrors the proven chat-photo-send pattern in usePackTimeline.sendMessage:
//   1. INSERT activity_feed row, return id
//   2. If photo: uploadVictoryPhoto(userId, id, localUri) → path
//   3. UPDATE row's photo_url with the path
//   4. On any upload/UPDATE failure: DELETE the just-inserted row
//      (no orphan rows) and surface the failure.
//
// Photo-only and caption-only shares are both valid. The SharePostSheet UI
// gates the call so at least one is present; this helper does not re-check
// (the caller's gate is the authoritative one).
//
// activity_type is one of the _share variants accepted by the
// activity_feed_activity_type_check CHECK constraint (added in migration
// 20260510_add_manual_share_activity_types.sql). entry_method is "manual".

import { supabase } from "./supabase";
import { uploadVictoryPhoto } from "./photoUpload";
import type { ActivityCategory } from "./activityCategoryMap";

export type ShareKind =
  | "steps_share"
  | "workout_share"
  | "calories_share"
  | "water_share";

export interface ShareContext {
  kind: ShareKind;
  userId: string;
  packId: string;
  packName: string;
  scoreDate: string; // YYYY-MM-DD in pack tz
  value: number; // day total for the category at share time
  category?: ActivityCategory; // workout_share only; null for the others
}

// Returns true on success, false on any failure (caller surfaces via Alert).
// No partial state on failure — the row is deleted if the photo path fails.
export async function createSharePost(
  ctx: ShareContext,
  caption: string | null,
  localUri: string | null,
): Promise<boolean> {
  // Step 1: INSERT row. id / created_at / comment_count are DB-side;
  // photo_url stays null until the upload (if any) lands. healthkit_uuid
  // is omitted — shares have no HK provenance.
  const { data, error: insErr } = await supabase
    .from("activity_feed")
    .insert({
      pack_id: ctx.packId,
      user_id: ctx.userId,
      activity_type: ctx.kind,
      value: ctx.value,
      points_earned: 0,
      entry_method: "manual",
      score_date: ctx.scoreDate,
      category: ctx.category ?? null,
      caption,
    })
    .select("id")
    .single();

  if (insErr || !data) {
    console.error("[createSharePost] insert error:", insErr);
    return false;
  }

  const newId = (data as { id: string }).id;

  // Step 2: photo upload, keyed off the just-inserted id. Skipped when
  // there's no photo — caption-only share is a valid outcome here.
  if (localUri) {
    const photoPath = await uploadVictoryPhoto(ctx.userId, newId, localUri);
    if (!photoPath) {
      // Upload failed — delete the row so we don't leave a captionless,
      // photoless ghost (or a caption-only row the user didn't intend to
      // submit alone).
      await supabase.from("activity_feed").delete().eq("id", newId);
      return false;
    }

    const { error: updErr } = await supabase
      .from("activity_feed")
      .update({ photo_url: photoPath })
      .eq("id", newId);

    if (updErr) {
      console.error("[createSharePost] photo_url update error:", updErr);
      await supabase.from("activity_feed").delete().eq("id", newId);
      return false;
    }
  }

  return true;
}
