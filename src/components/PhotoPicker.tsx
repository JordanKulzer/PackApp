import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  Modal,
  StyleSheet,
  Alert,
  Platform,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  pickFromLibrary,
  takeWithCamera,
  type PickedPhoto,
} from "../lib/photoUpload";
import { colors } from "../theme/colors";

const C = {
  bg: "#0B0F14",
  surface: "#121821",
  surfaceRaised: "#1C2333",
  border: "#30363D",
  textPrimary: "#E6EDF3",
  textSecondary: "#8B949E",
  textTertiary: "#484F58",
  accent: colors.self,
} as const;

interface PhotoPickerProps {
  photo: PickedPhoto | null;
  onPhotoSelected: (photo: PickedPhoto) => void;
  onPhotoRemoved: () => void;
  disabled?: boolean;
}

export function PhotoPicker({
  photo,
  onPhotoSelected,
  onPhotoRemoved,
  disabled = false,
}: PhotoPickerProps) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const handleSource = async (source: "library" | "camera") => {
    setSheetOpen(false);
    const picked = source === "library"
      ? await pickFromLibrary()
      : await takeWithCamera();
    if (!picked) {
      if (source === "library") {
        Alert.alert(
          "Photo Access",
          "Photo access is needed. Enable it in Settings > Privacy > Photos.",
        );
      } else {
        Alert.alert(
          "Camera Access",
          "Camera access is needed. Enable it in Settings > Privacy > Camera.",
        );
      }
      return;
    }
    onPhotoSelected(picked);
  };

  if (photo) {
    return (
      <View style={s.preview}>
        <Image source={{ uri: photo.uri }} style={s.thumbnail} />
        <TouchableOpacity
          style={s.removeBtn}
          onPress={onPhotoRemoved}
          hitSlop={8}
          activeOpacity={0.7}
        >
          <Ionicons name="close-circle" size={18} color={C.textSecondary} />
        </TouchableOpacity>
        <Text style={s.previewLabel}>Photo attached</Text>
      </View>
    );
  }

  return (
    <>
      <TouchableOpacity
        style={[s.addLink, disabled && s.addLinkDisabled]}
        onPress={() => setSheetOpen(true)}
        disabled={disabled}
        activeOpacity={0.7}
      >
        <Ionicons name="camera-outline" size={14} color={C.textSecondary} />
        <Text style={s.addLinkText}>Add photo</Text>
      </TouchableOpacity>

      <Modal
        visible={sheetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSheetOpen(false)}
      >
        <Pressable style={s.overlay} onPress={() => setSheetOpen(false)}>
          <Pressable style={s.sheet}>
            <View style={s.handle} />
            <Text style={s.sheetTitle}>Add Photo</Text>

            <TouchableOpacity
              style={s.sheetRow}
              onPress={() => handleSource("camera")}
              activeOpacity={0.7}
            >
              <Ionicons name="camera-outline" size={22} color={C.textPrimary} />
              <Text style={s.sheetRowText}>Take Photo</Text>
            </TouchableOpacity>

            <View style={s.sheetDivider} />

            <TouchableOpacity
              style={s.sheetRow}
              onPress={() => handleSource("library")}
              activeOpacity={0.7}
            >
              <Ionicons name="image-outline" size={22} color={C.textPrimary} />
              <Text style={s.sheetRowText}>Choose from Library</Text>
            </TouchableOpacity>

            {Platform.OS === "ios" && <View style={{ height: 20 }} />}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  addLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingVertical: 6,
  },
  addLinkDisabled: { opacity: 0.4 },
  addLinkText: {
    fontSize: 13,
    color: C.textSecondary,
    fontWeight: "500",
  },

  preview: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 4,
  },
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: C.surfaceRaised,
  },
  removeBtn: {
    position: "absolute",
    top: -2,
    left: 44,
  },
  previewLabel: {
    fontSize: 13,
    color: C.textSecondary,
  },

  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: C.surfaceRaised,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 34 : 16,
    borderTopWidth: 0.5,
    borderColor: C.border,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: "center",
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: C.textPrimary,
    marginBottom: 12,
  },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
  },
  sheetRowText: {
    fontSize: 16,
    color: C.textPrimary,
  },
  sheetDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.border,
  },
});
