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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
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
  accent: "#2F81F7",
  gold: "#D4A017",
} as const;

interface Props {
  feedItemId: string;
  userId: string;
  packName: string;
  winningPoints: number;
  scoreDate: string;
  visible: boolean;
  onClose: () => void;
  onPosted: () => void;
}

function relativeDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return "today";
  if (diff === 1) return "yesterday";
  return `${diff} days ago`;
}

export function VictoryPostSheet({
  feedItemId,
  userId,
  packName,
  winningPoints,
  scoreDate,
  visible,
  onClose,
  onPosted,
}: Props) {
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [posting, setPosting] = useState(false);

  const handlePickPhoto = () => {
    const doUpload = async (picker: typeof pickAvatarFromLibrary) => {
      const photo = await picker();
      if (!photo) return;
      setLocalUri(photo.uri);
    };

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Take Photo", "Choose from Library", "Cancel"],
          cancelButtonIndex: 2,
        },
        (idx) => {
          if (idx === 0) doUpload(takeAvatarPhoto);
          else if (idx === 1) doUpload(pickAvatarFromLibrary);
        },
      );
    } else {
      Alert.alert("Add photo", undefined, [
        { text: "Take Photo", onPress: () => doUpload(takeAvatarPhoto) },
        { text: "Choose from Library", onPress: () => doUpload(pickAvatarFromLibrary) },
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
    onClose();
  };

  const handleClose = () => {
    if (posting) return;
    setLocalUri(null);
    setCaption("");
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <Pressable style={s.overlay} onPress={handleClose} />
      <View style={s.sheet}>
        {/* Header */}
        <View style={s.header}>
          <View style={s.handle} />
          <Text style={s.title}>Share your victory</Text>
          <TouchableOpacity style={s.closeBtn} onPress={handleClose} hitSlop={8}>
            <Ionicons name="close" size={20} color={C.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Subtitle */}
        <Text style={s.subtitle}>
          {packName} · {winningPoints} pts · {relativeDate(scoreDate)}
        </Text>

        {/* Photo picker area */}
        <TouchableOpacity
          style={s.photoPicker}
          onPress={handlePickPhoto}
          activeOpacity={0.8}
        >
          {localUri ? (
            <Image source={{ uri: localUri }} style={s.photoPreview} resizeMode="cover" />
          ) : (
            <View style={s.photoPlaceholder}>
              <Ionicons name="camera-outline" size={32} color={C.textTertiary} />
              <Text style={s.photoHint}>Tap to add a photo</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Caption input */}
        <TextInput
          style={s.captionInput}
          placeholder="What did it take? (optional)"
          placeholderTextColor={C.textTertiary}
          value={caption}
          onChangeText={(t) => setCaption(t.slice(0, 140))}
          multiline
          maxLength={140}
        />

        {/* Post button */}
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
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 0.5,
    borderColor: C.border,
    paddingBottom: 32,
  },
  header: {
    alignItems: "center",
    paddingTop: 10,
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    marginBottom: 10,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
    color: C.textPrimary,
  },
  closeBtn: {
    position: "absolute",
    right: 16,
    top: 14,
  },
  subtitle: {
    fontSize: 13,
    color: C.textSecondary,
    textAlign: "center",
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  photoPicker: {
    marginHorizontal: 16,
    borderRadius: 12,
    overflow: "hidden",
    height: 220,
    backgroundColor: C.surfaceRaised,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 12,
  },
  photoPreview: {
    width: "100%",
    height: "100%",
  },
  photoPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  photoHint: {
    fontSize: 13,
    color: C.textTertiary,
  },
  captionInput: {
    marginHorizontal: 16,
    backgroundColor: C.surfaceRaised,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: C.textPrimary,
    minHeight: 60,
    maxHeight: 100,
    marginBottom: 16,
  },
  postBtn: {
    marginHorizontal: 16,
    height: 50,
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
    fontWeight: "700",
    color: "#FFF",
  },
});
