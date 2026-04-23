import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system/legacy";
import { decode as base64Decode } from "base64-arraybuffer";
import { supabase } from "./supabase";
import { analytics } from "./analytics";

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
