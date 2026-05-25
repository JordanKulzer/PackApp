// Intentional-sharing Phase 2 — the Share composer.
//
// Forked from VictoryPostSheet. Same modal/layout/photo-picker/caption
// scaffolding; different DB shape: this sheet INSERTs a new activity_feed
// row instead of UPDATEing an existing one, and the photo is OPTIONAL
// (Post is enabled with a non-empty caption alone, a photo alone, or both).
//
// Carry-over from VictoryPostSheet (unchanged structurally):
//   - Modal + KeyboardAvoidingView + drag handle + sheet shape
//   - 140-char caption input + counter
//   - Photo-picker ActionSheet (iOS) / Alert (Android) shape
//   - Style sheet (kept as a local copy here; cosmetic divergence later
//     can be done without affecting VictoryPostSheet)
//
// Diverges from VictoryPostSheet:
//   - Uses pickFromLibrary / takeWithCamera (NOT the avatar-specific
//     pickAvatarFromLibrary / takeAvatarPhoto). Same module, same shape.
//   - Props take a ShareContext { kind, userId, packId, packName,
//     scoreDate, value, category? } — no required feedItemId.
//   - HEADER_COPY uses share framing per kind.
//   - Post button gates on (photo OR non-empty caption) && !posting —
//     photo is OPTIONAL.
//   - handlePost calls createSharePost (src/lib/sharePost.ts), which
//     handles INSERT → photo upload → UPDATE → cleanup-on-failure.

import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Pressable,
  Platform,
  ActionSheetIOS,
  KeyboardAvoidingView,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { pickFromLibrary, takeWithCamera } from "../lib/photoUpload";
import { createSharePost, type ShareContext, type ShareKind } from "../lib/sharePost";
import { CATEGORY_DISPLAY_NAMES } from "../lib/activityCategoryMap";

const C = {
  bg: "#0B0F14",
  surface: "#121821",
  surfaceRaised: "#1C2333",
  border: "#30363D",
  textPrimary: "#E6EDF3",
  textSecondary: "#8B949E",
  textTertiary: "#484F58",
  accent: "#2563EB",
  gold: "#fbbf24",
} as const;

const HEADER_COPY: Record<
  ShareKind,
  { title: string; subtitleTemplate: string }
> = {
  steps_share: {
    title: "Share your steps",
    subtitleTemplate: "{value} steps · {packName}",
  },
  workout_share: {
    title: "Share your workout",
    // {category} is interpolated against the display name (e.g. "Yoga"),
    // falling back to "Workout" when no category was passed.
    subtitleTemplate: "{category} · {packName}",
  },
  calories_share: {
    title: "Share your calories",
    subtitleTemplate: "{value} cal · {packName}",
  },
  water_share: {
    title: "Share your water",
    subtitleTemplate: "{value} oz · {packName}",
  },
};

function interpolateSubtitle(template: string, ctx: ShareContext): string {
  const categoryLabel = ctx.category
    ? CATEGORY_DISPLAY_NAMES[ctx.category]
    : "Workout";
  return template
    .replace("{packName}", ctx.packName)
    .replace("{value}", ctx.value.toLocaleString())
    .replace("{category}", categoryLabel);
}

interface Props {
  visible: boolean;
  onDismiss: () => void;
  onPosted: () => void;
  share: ShareContext;
}

export function SharePostSheet({ visible, onDismiss, onPosted, share }: Props) {
  const { title, subtitleTemplate } = HEADER_COPY[share.kind];
  const subtitle = interpolateSubtitle(subtitleTemplate, share);
  const insets = useSafeAreaInsets();
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [posting, setPosting] = useState(false);

  const charsLeft = 140 - caption.length;
  const counterColor = charsLeft <= 10 ? "#ef4444" : C.textTertiary;

  // Post enabled when at least one of {photo, caption} is set. Both
  // empty is the only blocked state — sharing nothing is not a thing.
  const canPost = (!!localUri || caption.trim().length > 0) && !posting;

  const handlePickPhoto = () => {
    const pick = async (picker: typeof pickFromLibrary) => {
      const photo = await picker();
      if (photo) setLocalUri(photo.uri);
    };

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Take Photo", "Choose from Library", "Cancel"],
          cancelButtonIndex: 2,
        },
        (idx) => {
          if (idx === 0) pick(takeWithCamera);
          else if (idx === 1) pick(pickFromLibrary);
        },
      );
    } else {
      Alert.alert("Add photo", undefined, [
        { text: "Take Photo", onPress: () => pick(takeWithCamera) },
        { text: "Choose from Library", onPress: () => pick(pickFromLibrary) },
        { text: "Cancel", style: "cancel" },
      ]);
    }
  };

  const handlePost = async () => {
    if (!canPost) return;
    setPosting(true);

    const trimmedCaption = caption.trim() || null;
    const ok = await createSharePost(share, trimmedCaption, localUri);

    if (!ok) {
      Alert.alert("Failed to post", "Please try again.");
      setPosting(false);
      return;
    }

    setPosting(false);
    setLocalUri(null);
    setCaption("");
    onPosted();
    onDismiss();
  };

  const handleClose = () => {
    if (posting) return;
    setLocalUri(null);
    setCaption("");
    onDismiss();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <Pressable style={s.overlay} onPress={handleClose} />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={s.kav}
      >
        <View style={[s.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={s.handleWrap}>
            <View style={s.handle} />
          </View>

          <View style={s.header}>
            <Text style={s.title}>{title}</Text>
            <TouchableOpacity style={s.closeBtn} onPress={handleClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={C.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={s.scroll}
            contentContainerStyle={s.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={s.contextPill}>
              <Text style={s.contextPillText}>{subtitle}</Text>
            </View>

            {/* Photo picker — OPTIONAL. Tap to choose; the placeholder
                stays visible until a photo is picked. */}
            <TouchableOpacity
              style={s.photoPicker}
              onPress={handlePickPhoto}
              activeOpacity={0.8}
            >
              {localUri ? (
                <>
                  <Image source={{ uri: localUri }} style={s.photoPreview} resizeMode="cover" />
                  <TouchableOpacity
                    style={s.removePhotoBtn}
                    onPress={() => setLocalUri(null)}
                    hitSlop={8}
                  >
                    <Ionicons name="close-circle" size={24} color="#FFF" />
                  </TouchableOpacity>
                </>
              ) : (
                <View style={s.photoPlaceholder}>
                  <Ionicons name="camera-outline" size={32} color={C.textTertiary} />
                  <Text style={s.photoHint}>Tap to add a photo (optional)</Text>
                </View>
              )}
            </TouchableOpacity>

            <TextInput
              style={s.captionInput}
              placeholder="Tell the pack about it"
              placeholderTextColor={C.textTertiary}
              value={caption}
              onChangeText={(t) => setCaption(t.slice(0, 140))}
              multiline
              maxLength={140}
              numberOfLines={2}
            />
            <Text style={[s.charCounter, { color: counterColor }]}>
              {caption.length}/140
            </Text>
          </ScrollView>

          <View style={s.footer}>
            <TouchableOpacity
              style={[s.postBtn, !canPost && s.postBtnDisabled]}
              onPress={handlePost}
              disabled={!canPost}
              activeOpacity={0.85}
            >
              {posting ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={s.postBtnText}>Post</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  kav: {
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 0.5,
    borderColor: C.border,
    maxHeight: "90%",
  },
  handleWrap: {
    alignItems: "center",
    paddingTop: 12,
    paddingBottom: 4,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: C.textPrimary,
  },
  closeBtn: {
    padding: 2,
  },
  scroll: {
    flexShrink: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  contextPill: {
    alignSelf: "center",
    backgroundColor: "rgba(251,191,36,0.12)",
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.3)",
    borderRadius: 9999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 24,
  },
  contextPillText: {
    fontSize: 13,
    fontWeight: "500",
    color: C.gold,
  },
  photoPicker: {
    width: "100%",
    aspectRatio: 1,
    minHeight: 280,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.15)",
    borderStyle: "dashed",
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 16,
  },
  photoPreview: {
    width: "100%",
    height: "100%",
  },
  removePhotoBtn: {
    position: "absolute",
    top: 10,
    right: 10,
  },
  photoPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  photoHint: {
    fontSize: 15,
    fontWeight: "500",
    color: C.textTertiary,
  },
  captionInput: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: C.textPrimary,
    minHeight: 72,
    maxHeight: 112,
    textAlignVertical: "top",
  },
  charCounter: {
    fontSize: 12,
    textAlign: "right",
    marginTop: 4,
    marginBottom: 4,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  postBtn: {
    height: 52,
    backgroundColor: C.accent,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  postBtnDisabled: {
    opacity: 0.4,
  },
  postBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFF",
  },
});
