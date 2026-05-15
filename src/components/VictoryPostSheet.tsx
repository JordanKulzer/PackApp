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
import {
  pickAvatarFromLibrary,
  takeAvatarPhoto,
  uploadVictoryPhoto,
} from "../lib/photoUpload";
import { supabase } from "../lib/supabase";

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

// Pass 25-followup-E.2.b.ii: VictoryPostSheet generalized from daily_winner-
// only to any achievement kind. The sheet's UI is identity-agnostic (photo
// picker + caption + Post button); per-kind context is carried via the
// `achievement` object discriminated by `kind`. Three kinds are live in
// E.2.b scope (daily_winner, took_lead, all_goals). Four more (steps,
// workout, calories, water) are forward-compat for E.3's manual-share path
// — the sheet's submit logic already handles them, but the emit path that
// creates the share-type activity_feed row lands later.
export type AchievementKind =
  | "daily_winner" | "took_lead" | "all_goals"
  | "steps" | "workout" | "calories" | "water";

export interface AchievementContext {
  kind: AchievementKind;
  feedItemId: string;
  userId: string;
  packId: string;
  packName: string;
  scoreDate: string;
  pointsEarned: number;
  value?: number;        // steps count / cal count / oz — for kinds that surface a value
  rank?: number;         // for took_lead variants ("#1 · {points} pts")
  leadGap?: number;      // took_lead only: weekly points gap to #2 at INSERT time
  opponentName?: string; // took_lead only: display_name of #2 at hydration time
}

interface Props {
  visible: boolean;
  onDismiss: () => void;
  onPosted: () => void;
  achievement: AchievementContext;
}

// Header copy per achievement kind. Title appears at the top of the sheet;
// subtitle renders inside the context pill below it. Subtitle templates are
// interpolated at render time from the achievement object. Emoji deliberately
// dropped — title prestige carried by the design language, not ceremony.
const HEADER_COPY: Record<
  AchievementKind,
  { title: string; subtitleTemplate: string }
> = {
  daily_winner: { title: "You won the day",  subtitleTemplate: "{packName} · {points} pts · Yesterday" },
  took_lead:    { title: "You took the lead", subtitleTemplate: "{packName} · +{leadGap} pts{opponentSuffix}" },
  all_goals:    { title: "All goals hit",     subtitleTemplate: "{packName} · {date}" },
  steps:        { title: "Steps goal hit",    subtitleTemplate: "{packName} · {value} steps" },
  workout:      { title: "Workout logged",    subtitleTemplate: "{packName} · {points} pts" },
  calories:     { title: "Calories goal hit", subtitleTemplate: "{packName} · {value} cal" },
  water:        { title: "Water goal hit",    subtitleTemplate: "{packName} · {value} oz" },
};

function interpolateSubtitle(
  template: string,
  achievement: AchievementContext,
): string {
  const opponentSuffix = achievement.opponentName
    ? ` over ${achievement.opponentName}`
    : "";
  return template
    .replace("{packName}", achievement.packName)
    .replace("{leadGap}", String(achievement.leadGap ?? 0))
    .replace("{opponentSuffix}", opponentSuffix)
    .replace("{points}", String(achievement.pointsEarned))
    .replace("{value}", String(achievement.value ?? 0))
    .replace("{rank}", String(achievement.rank ?? 0))
    .replace("{date}", achievement.scoreDate);
}

export function VictoryPostSheet({
  visible,
  onDismiss,
  onPosted,
  achievement,
}: Props) {
  const { feedItemId, userId } = achievement;
  const { title, subtitleTemplate } = HEADER_COPY[achievement.kind];
  const subtitle = interpolateSubtitle(subtitleTemplate, achievement);
  const insets = useSafeAreaInsets();
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [posting, setPosting] = useState(false);

  const charsLeft = 140 - caption.length;
  const counterColor = charsLeft <= 10 ? "#ef4444" : C.textTertiary;

  const handlePickPhoto = () => {
    const pick = async (picker: typeof pickAvatarFromLibrary) => {
      const photo = await picker();
      if (photo) setLocalUri(photo.uri);
    };

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ["Take Photo", "Choose from Library", "Cancel"], cancelButtonIndex: 2 },
        (idx) => {
          if (idx === 0) pick(takeAvatarPhoto);
          else if (idx === 1) pick(pickAvatarFromLibrary);
        },
      );
    } else {
      Alert.alert("Add photo", undefined, [
        { text: "Take Photo", onPress: () => pick(takeAvatarPhoto) },
        { text: "Choose from Library", onPress: () => pick(pickAvatarFromLibrary) },
        { text: "Cancel", style: "cancel" },
      ]);
    }
  };

  const handlePost = async () => {
    if (!localUri || posting) return;
    setPosting(true);

    const path = await uploadVictoryPhoto(userId, feedItemId, localUri);
    if (!path) {
      Alert.alert("Upload failed", "Please try again.");
      setPosting(false);
      return;
    }

    const trimmedCaption = caption.trim() || null;
    const { error } = await supabase
      .from("activity_feed")
      .update({ photo_url: path, caption: trimmedCaption })
      .eq("id", feedItemId);

    if (error) {
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
          {/* Drag handle */}
          <View style={s.handleWrap}>
            <View style={s.handle} />
          </View>

          {/* Header */}
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
            {/* Context pill — per-kind subtitle interpolated from HEADER_COPY */}
            <View style={s.contextPill}>
              <Text style={s.contextPillText}>{subtitle}</Text>
            </View>

            {/* Photo picker */}
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
                  <Text style={s.photoHint}>Tap to add a photo</Text>
                </View>
              )}
            </TouchableOpacity>

            {/* Caption */}
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

          {/* Post button — outside ScrollView so it stays above keyboard */}
          <View style={s.footer}>
            <TouchableOpacity
              style={[s.postBtn, (!localUri || posting) && s.postBtnDisabled]}
              onPress={handlePost}
              disabled={!localUri || posting}
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
