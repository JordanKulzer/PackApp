import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system/legacy";
import { Image } from "react-native";
import { decode as base64Decode } from "base64-arraybuffer";
import { supabase } from "./supabase";
import { analytics } from "./analytics";

// ─── Shared resize helper ────────────────────────────────────────────────────
// Reads the source image dimensions, then mirrors compressPhoto's
// proportional-scale math (scale by maxEdge / maxDim, apply to both
// width and height so aspect ratio is preserved). Returns the
// ImageManipulator action, or null when the image already fits
// (no resize needed) or its size couldn't be read (skip resize —
// upload at native dimensions; better than squashing to a square).
//
// Bug C fix: uploadVictoryPhoto + uploadChatPhoto previously did
// `resize: { width: MAX, height: MAX }` which forces an exact-pixel
// stretch to a square. This helper replaces that with the
// proportional pattern compressPhoto already uses correctly.
async function proportionalResizeAction(
  uri: string,
  maxEdge: number,
): Promise<ImageManipulator.Action | null> {
  const size = await new Promise<{ width: number; height: number } | null>(
    (resolve) => {
      Image.getSize(
        uri,
        (width, height) => resolve({ width, height }),
        () => resolve(null),
      );
    },
  );
  if (!size || size.width <= 0 || size.height <= 0) return null;
  const maxDim = Math.max(size.width, size.height);
  if (maxDim <= maxEdge) return null;
  const scale = maxEdge / maxDim;
  return {
    resize: {
      width: Math.round(size.width * scale),
      height: Math.round(size.height * scale),
    },
  };
}

const BUCKET = "activity_photos";
const MAX_LONG_EDGE = 1080;
const JPEG_QUALITY = 0.8;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// ─── Permissions ──────────────────────────────────────────────────────────────

export async function requestLibraryPermission(): Promise<boolean> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return status === "granted";
}

export async function requestCameraPermission(): Promise<boolean> {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  return status === "granted";
}

// ─── Picking ──────────────────────────────────────────────────────────────────

export interface PickedPhoto {
  uri: string;
  width: number;
  height: number;
}

export async function pickFromLibrary(): Promise<PickedPhoto | null> {
  const granted = await requestLibraryPermission();
  if (!granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: false,
    quality: 1,
  });
  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, width: asset.width, height: asset.height };
}

export async function takeWithCamera(): Promise<PickedPhoto | null> {
  const granted = await requestCameraPermission();
  if (!granted) return null;
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ["images"],
    allowsEditing: false,
    quality: 1,
  });
  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, width: asset.width, height: asset.height };
}

// ─── Compression ──────────────────────────────────────────────────────────────

export async function compressPhoto(photo: PickedPhoto): Promise<string> {
  const { uri, width, height } = photo;
  const maxDim = Math.max(width, height);
  const actions: ImageManipulator.Action[] = [];

  if (maxDim > MAX_LONG_EDGE) {
    const scale = MAX_LONG_EDGE / maxDim;
    actions.push({
      resize: {
        width: Math.round(width * scale),
        height: Math.round(height * scale),
      },
    });
  }

  const result = await ImageManipulator.manipulateAsync(uri, actions, {
    compress: JPEG_QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return result.uri;
}

// ─── Upload ───────────────────────────────────────────────────────────────────

function uniquePath(userId: string): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 9);
  return `${userId}/${ts}-${rand}.jpg`;
}

export async function uploadPhoto(
  userId: string,
  photo: PickedPhoto,
): Promise<string> {
  const compressedUri = await compressPhoto(photo);
  const path = uniquePath(userId);

  const base64 = await FileSystem.readAsStringAsync(compressedUri, {
    encoding: "base64",
  });
  const arrayBuffer = base64Decode(base64);

  if (arrayBuffer.byteLength > MAX_BYTES) {
    throw new Error("Photo exceeds 5 MB — please choose a smaller image.");
  }

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, arrayBuffer, { contentType: "image/jpeg", upsert: false });

  if (error) {
    console.error("[photoUpload] supabase upload error:", {
      message: error.message,
      name: error.name,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      statusCode: (error as any)?.statusCode,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fullError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
    });
    throw error;
  }

  return path;
}

// ─── Signed URL ───────────────────────────────────────────────────────────────

const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

export async function getSignedUrl(path: string): Promise<string | null> {
  const cached = signedUrlCache.get(path);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.url;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600);

  if (error || !data) {
    console.error("[photoUpload] getSignedUrl error:", error);
    return null;
  }

  signedUrlCache.set(path, { url: data.signedUrl, expiresAt: Date.now() + 3_500_000 });
  return data.signedUrl;
}

// ─── Deletion ─────────────────────────────────────────────────────────────────

export async function deletePhoto(path: string): Promise<void> {
  signedUrlCache.delete(path);
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}

// ─── Feed attachment ──────────────────────────────────────────────────────────

// After an activity is logged, finds the most recent feed entry for that
// user/pack/type today that doesn't yet have a photo, and sets its photo_url.
export async function attachPhotoToLatestFeedEntry(
  userId: string,
  packId: string,
  activityType: string,
  storagePath: string,
): Promise<void> {
  console.log("[attachPhotoToLatestFeedEntry] called", {
    userId,
    packId,
    activityType,
    storagePath,
  });

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data: entry } = await supabase
    .from("activity_feed")
    .select("id")
    .eq("pack_id", packId)
    .eq("user_id", userId)
    .eq("activity_type", activityType)
    .gte("created_at", todayStart.toISOString())
    .is("photo_url", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  console.log("[attachPhotoToLatestFeedEntry] feed entry query result", {
    found: !!entry,
    entryId: entry?.id,
  });

  if (!entry) {
    console.warn("[attachPhotoToLatestFeedEntry] no matching feed row — photo orphaned", {
      userId,
      packId,
      activityType,
    });
    return;
  }

  const { error: updateError, data: updateData } = await supabase
    .from("activity_feed")
    .update({ photo_url: storagePath })
    .eq("id", entry.id)
    .select();

  if (updateError) {
    console.error("[attachPhotoToLatestFeedEntry] update failed", updateError);
  } else {
    console.log("[attachPhotoToLatestFeedEntry] update success", {
      entryId: entry.id,
      rowsAffected: updateData?.length ?? 0,
    });
  }
}

// ─── Report ───────────────────────────────────────────────────────────────────

// ─── Avatar upload ────────────────────────────────────────────────────────────

const AVATAR_BUCKET = "avatars";
const AVATAR_SIZE = 400;

export async function pickAvatarFromLibrary(): Promise<PickedPhoto | null> {
  const granted = await requestLibraryPermission();
  if (!granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });
  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, width: asset.width, height: asset.height };
}

export async function takeAvatarPhoto(): Promise<PickedPhoto | null> {
  const granted = await requestCameraPermission();
  if (!granted) return null;
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });
  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, width: asset.width, height: asset.height };
}

/**
 * Compress, upload, and return a cache-busted public URL for the user's avatar.
 * Writes to avatars/{userId}/avatar.jpg with upsert:true.
 */
export async function uploadAvatar(userId: string, photo: PickedPhoto): Promise<string> {
  const compressed = await ImageManipulator.manipulateAsync(
    photo.uri,
    [{ resize: { width: AVATAR_SIZE, height: AVATAR_SIZE } }],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
  );

  const base64 = await FileSystem.readAsStringAsync(compressed.uri, {
    encoding: "base64",
  });
  const arrayBuffer = base64Decode(base64);

  const path = `${userId}/avatar.jpg`;

  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, arrayBuffer, {
      contentType: "image/jpeg",
      upsert: true,
      cacheControl: "3600",
    });

  if (uploadError) throw new Error(`Avatar upload failed: ${uploadError.message}`);

  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

/**
 * Delete the user's avatar from storage and clears users.avatar_url in the DB.
 */
export async function deleteAvatar(userId: string): Promise<void> {
  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .remove([`${userId}/avatar.jpg`]);
  if (error) throw new Error(`Avatar delete failed: ${error.message}`);
}

// ─── Victory photo ────────────────────────────────────────────────────────────

const VICTORY_BUCKET = "activity_photos";
const VICTORY_MAX_EDGE = 800;

// Uploads a victory post photo. Returns the storage path, or null on failure.
// Requires the activity_photos bucket to exist (reuses existing bucket).
export async function uploadVictoryPhoto(
  userId: string,
  feedItemId: string,
  localUri: string,
): Promise<string | null> {
  try {
    // Bug C fix: was `resize: { width: MAX, height: MAX }` which forces
    // an exact-pixel stretch to a square (any non-square photo was
    // distorted before storage). Now reads the source dimensions and
    // applies a proportional resize via the shared helper.
    const resizeAction = await proportionalResizeAction(
      localUri,
      VICTORY_MAX_EDGE,
    );
    const actions: ImageManipulator.Action[] = resizeAction
      ? [resizeAction]
      : [];
    const compressed = await ImageManipulator.manipulateAsync(
      localUri,
      actions,
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
    );

    const base64 = await FileSystem.readAsStringAsync(compressed.uri, {
      encoding: "base64",
    });
    const arrayBuffer = base64Decode(base64);

    // Pass 25-followup-E.2.b.iii-fix-storage: first folder MUST be userId
    // to satisfy the activity_photos bucket's INSERT RLS policy (policy
    // requires first folder of path to match auth.uid()). The prior
    // `victory/{userId}/...` scheme failed silently with a "Bucket not
    // found" error from Storage's RLS layer. "victory" semantic preserved
    // in the filename prefix instead of the folder.
    const path = `${userId}/victory_${feedItemId}.jpg`;

    // Pass 25-followup-E.2.b.iii-fix-storage-2: upsert MUST be false to
    // match uploadPhoto's working pattern. supabase-js routes upsert:true
    // via PUT, which triggers storage.objects's UPDATE RLS policy. The
    // activity_photos bucket has an INSERT policy (first-folder = uid)
    // but no matching UPDATE policy, so PUT requests fail with "new row
    // violates row-level security policy" even on first upload (Storage's
    // RLS layer flattens the rejection into INSERT-style error wording).
    // upsert: false routes via POST → INSERT path → policy satisfied.
    // Path uniqueness via feedItemId makes collision a non-concern.
    const { error } = await supabase.storage
      .from(VICTORY_BUCKET)
      .upload(path, arrayBuffer, {
        contentType: "image/jpeg",
        upsert: false,
        cacheControl: "3600",
      });

    if (error) {
      console.error("[uploadVictoryPhoto] upload error:", error.message);
      return null;
    }

    return path;
  } catch (e) {
    console.error("[uploadVictoryPhoto] error:", (e as Error).message);
    return null;
  }
}

// ─── Chat photo ───────────────────────────────────────────────────────────────

const CHAT_BUCKET = "activity_photos";
const CHAT_MAX_EDGE = 1080;

// Uploads a chat-attached photo. Returns the storage path, or null on failure.
// Pass C-revised: parallel to uploadVictoryPhoto but keyed by chatMessageId.
// Caller generates the chatMessageId (UUID via expo-crypto.randomUUID) BEFORE
// the chat_messages INSERT so the storage path can be written into photo_url
// atomically with the INSERT. Bucket RLS (first folder = auth.uid()) and
// upsert:false rationale identical to uploadVictoryPhoto — see its comment
// block for the full RLS reasoning.
export async function uploadChatPhoto(
  userId: string,
  chatMessageId: string,
  localUri: string,
): Promise<string | null> {
  try {
    // Bug C fix (sister to uploadVictoryPhoto): proportional resize via
    // the shared helper instead of the prior square-stretch resize.
    const resizeAction = await proportionalResizeAction(
      localUri,
      CHAT_MAX_EDGE,
    );
    const actions: ImageManipulator.Action[] = resizeAction
      ? [resizeAction]
      : [];
    const compressed = await ImageManipulator.manipulateAsync(
      localUri,
      actions,
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
    );

    const base64 = await FileSystem.readAsStringAsync(compressed.uri, {
      encoding: "base64",
    });
    const arrayBuffer = base64Decode(base64);

    const path = `${userId}/chat_${chatMessageId}.jpg`;

    const { error } = await supabase.storage
      .from(CHAT_BUCKET)
      .upload(path, arrayBuffer, {
        contentType: "image/jpeg",
        upsert: false,
        cacheControl: "3600",
      });

    if (error) {
      console.error("[uploadChatPhoto] upload error:", error.message);
      return null;
    }

    return path;
  } catch (e) {
    console.error("[uploadChatPhoto] error:", (e as Error).message);
    return null;
  }
}

// ─── Report ───────────────────────────────────────────────────────────────────

export async function reportPhoto(
  reporterId: string,
  feedItemId: string,
  photoUrl: string,
  reason: string,
): Promise<void> {
  await supabase.from("photo_reports").insert({
    reporter_id: reporterId,
    feed_item_id: feedItemId,
    photo_url: photoUrl,
    reason,
    status: "pending",
  });
  analytics.photoReported(reason);
}
