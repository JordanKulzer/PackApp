// Chat composer — text input + send button, with an edit-mode banner that
// shows above the input when editing an existing message. Lives at the
// bottom of ChatTab; sits above the bottom tab navigator. Wrap the whole
// thing in a KeyboardAvoidingView at the call site.
//
// Pass C-revised: adds an iMessage-style camera button to the left of the
// TextInput. Tapping opens the photo library (via photoUpload.pickFromLibrary)
// and the selected photo shows as a thumbnail above the input. Send then
// uploads + INSERTs the chat_messages row with photo_url set. Caption is
// optional when a photo is attached.

import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Pressable,
  Image,
  ActivityIndicator,
  Alert,
  Linking,
  ActionSheetIOS,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import type { ChatMessage } from "../types/database";
import { pickFromLibrary, takeWithCamera } from "../lib/photoUpload";

interface Props {
  // photoLocalUri is omitted on edits (editingMessage path doesn't carry it).
  onSend: (body: string, photoLocalUri?: string | null) => Promise<void> | void;
  onEdit: (messageId: string, newBody: string) => Promise<void> | void;
  editingMessage: ChatMessage | null;
  onCancelEdit: () => void;
}

const MAX_BODY_LENGTH = 1000;

export function ChatInputBar({
  onSend,
  onEdit,
  editingMessage,
  onCancelEdit,
}: Props) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  // Prefill on edit transition; clear when leaving edit mode. Photo is not
  // editable — editing a message strips any attachment-affordance UI by
  // clearing photoUri on entry.
  useEffect(() => {
    if (editingMessage) {
      setText(editingMessage.body);
      setPhotoUri(null);
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    } else {
      setText("");
    }
  }, [editingMessage]);

  const trimmed = text.trim();
  const hasText = trimmed.length > 0 && trimmed.length <= MAX_BODY_LENGTH;
  // Send is valid when there's text OR a photo attached (or both).
  // Editing path requires text — photo affordance is hidden in edit mode.
  const canSend =
    !submitting &&
    (editingMessage ? hasText : (hasText || !!photoUri));

  // pickFromLibrary / takeWithCamera internally request their respective
  // permissions and return null on either denial or cancel. When null comes
  // back we probe the permission status to distinguish a hard denial (nudge
  // to Settings) from a plain cancel (do nothing).
  const handleLibraryPick = async () => {
    const photo = await pickFromLibrary();
    if (photo) {
      setPhotoUri(photo.uri);
      return;
    }
    const status = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (status.status === "denied" && !status.canAskAgain) {
      Alert.alert(
        "Photo access required",
        "Enable photo library access in Settings to attach images.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ],
      );
    }
  };

  const handleCameraPick = async () => {
    const photo = await takeWithCamera();
    if (photo) {
      setPhotoUri(photo.uri);
      return;
    }
    const status = await ImagePicker.getCameraPermissionsAsync();
    if (status.status === "denied" && !status.canAskAgain) {
      Alert.alert(
        "Camera access required",
        "Enable camera access in Settings to take photos.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ],
      );
    }
  };

  // iOS-first app — native action sheet on iOS, Alert-based menu on Android.
  // Mirrors VictoryPostSheet's photo-source picker pattern for consistency.
  const handlePickPhoto = () => {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Take Photo", "Choose from Library", "Cancel"],
          cancelButtonIndex: 2,
        },
        (idx) => {
          if (idx === 0) handleCameraPick();
          else if (idx === 1) handleLibraryPick();
        },
      );
    } else {
      Alert.alert("Add photo", undefined, [
        { text: "Take Photo", onPress: () => handleCameraPick() },
        { text: "Choose from Library", onPress: () => handleLibraryPick() },
        { text: "Cancel", style: "cancel" },
      ]);
    }
  };

  const handleSubmit = async () => {
    if (!canSend) return;
    setSubmitting(true);
    try {
      if (editingMessage) {
        await onEdit(editingMessage.id, trimmed);
        // Caller clears editingMessage on success; the effect above clears
        // the input.
      } else {
        await onSend(trimmed, photoUri);
        setText("");
        setPhotoUri(null);
      }
    } catch (err) {
      // Supabase PostgrestErrors are plain objects, not Error instances —
      // String(err) on them yields "[object Object]". Read .message directly.
      Alert.alert(
        "Send failed",
        (err as { message?: string })?.message ?? String(err),
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Hide the camera button + thumbnail row when editing an existing message —
  // photo attachment is creation-only, not an edit-time affordance.
  const showAttachment = !editingMessage;

  return (
    <View>
      {editingMessage ? (
        <View style={s.editBanner}>
          <View style={s.editBannerLeft}>
            <Ionicons name="pencil" size={14} color="#0A84FF" />
            <Text style={s.editBannerText}>Editing message</Text>
          </View>
          <TouchableOpacity onPress={onCancelEdit} hitSlop={8}>
            <Text style={s.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {showAttachment && photoUri ? (
        <View style={s.thumbRow}>
          <View style={s.thumbWrap}>
            <Image source={{ uri: photoUri }} style={s.thumb} />
            {submitting ? (
              <View style={s.thumbOverlay}>
                <ActivityIndicator color="#FFFFFF" />
              </View>
            ) : (
              <Pressable
                style={s.thumbRemove}
                onPress={() => setPhotoUri(null)}
                hitSlop={6}
                disabled={submitting}
              >
                <Ionicons name="close-circle" size={22} color="#FFFFFF" />
              </Pressable>
            )}
          </View>
        </View>
      ) : null}

      <View style={s.bar}>
        {showAttachment ? (
          <Pressable
            style={({ pressed }) => [
              s.cameraBtn,
              pressed && { opacity: 0.6 },
              submitting && { opacity: 0.4 },
            ]}
            onPress={handlePickPhoto}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 6 }}
            disabled={submitting}
            accessibilityLabel="Attach photo"
          >
            <Ionicons name="camera" size={22} color="#8A8A8E" />
          </Pressable>
        ) : null}
        <TextInput
          ref={inputRef}
          style={s.input}
          value={text}
          onChangeText={setText}
          placeholder={
            editingMessage ? "Editing message..." : "Type a message..."
          }
          placeholderTextColor="#8A8A8E"
          multiline
          textAlignVertical="center"
          maxLength={MAX_BODY_LENGTH}
          editable={!submitting}
        />
        <Pressable
          style={({ pressed }) => [
            s.sendBtn,
            !canSend && s.sendBtnDisabled,
            pressed && canSend && { opacity: 0.7 },
          ]}
          onPress={handleSubmit}
          disabled={!canSend}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Ionicons
              name="arrow-up"
              size={20}
              color={canSend ? "#FFFFFF" : "#8A8A8E"}
            />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  // Edit-mode banner sits above the input bar.
  editBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: 36,
    paddingHorizontal: 16,
    backgroundColor: "#1C1C1E",
    borderTopWidth: 1,
    borderTopColor: "#2C2C2E",
  },
  editBannerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  editBannerText: {
    fontSize: 13,
    color: "#0A84FF",
    fontWeight: "500",
  },
  cancelText: {
    fontSize: 13,
    color: "#8A8A8E",
  },
  // Thumbnail preview row above the input bar. alignSelf: flex-start so
  // the row hugs the 72×72 thumbnail instead of spanning the full
  // composer width — the full-width background/border was creating a
  // large empty bar to the right of the thumbnail.
  thumbRow: {
    flexDirection: "row",
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  thumbWrap: {
    width: 72,
    height: 72,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#2C2C2E",
  },
  thumb: {
    width: "100%",
    height: "100%",
  },
  thumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  thumbRemove: {
    position: "absolute",
    top: 2,
    right: 2,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 11,
  },
  // Input bar. paddingBottom: 0 so the bar sits flush against whatever's
  // beneath it — keyboard's top edge when open (via KeyboardStickyView),
  // bottom tab navigator when closed (the tab nav handles its own
  // safe-area inset). The 8pt paddingTop gives the input row breathing
  // room from the hairline border above.
  bar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: "#1C1C1E",
    borderTopWidth: 1,
    borderTopColor: "#2C2C2E",
  },
  cameraBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4,
  },
  input: {
    flex: 1,
    minHeight: 36,
    maxHeight: 100,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#2C2C2E",
    borderRadius: 18,
    color: "#FFFFFF",
    fontSize: 15,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginLeft: 8,
    backgroundColor: "#0A84FF",
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: {
    backgroundColor: "#3A3A3C",
  },
});
