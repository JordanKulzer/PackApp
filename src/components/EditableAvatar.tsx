// Avatar circle + camera-icon edit affordance, used identically by the
// onboarding profile-setup screen and the Profile screen. Visual only —
// the caller owns the picker / upload / remove flow and passes its handler
// in via onPress. The icon itself isn't separately tappable; the whole
// circle is the press target so the affordance reads cleanly even for
// users who tap the avatar instead of the badge.

import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface Props {
  imageUri: string | null | undefined;
  fallbackInitial: string;
  /** Diameter in pt. Default 96 (matches onboarding). */
  size?: number;
  uploading?: boolean;
  onPress: () => void;
  /** Set false to render the avatar without the Edit pill (read-only). */
  showEditPill?: boolean;
  disabled?: boolean;
}

const C = {
  surfaceRaised: "#1C2333",
  border: "#30363D",
  textPrimary: "#E6EDF3",
  accent: "#2F81F7",
} as const;

export function EditableAvatar({
  imageUri,
  fallbackInitial,
  size = 96,
  uploading = false,
  onPress,
  showEditPill = true,
  disabled = false,
}: Props) {
  const radius = size / 2;
  return (
    <Pressable
      style={[s.wrap, { width: size, height: size, borderRadius: radius }]}
      onPress={onPress}
      disabled={disabled || uploading}
    >
      {imageUri ? (
        <Image
          source={{ uri: imageUri }}
          style={[
            s.image,
            { width: size, height: size, borderRadius: radius },
          ]}
        />
      ) : (
        <View
          style={[
            s.placeholder,
            { width: size, height: size, borderRadius: radius },
          ]}
        >
          <Text style={[s.initial, { fontSize: size * 0.375 }]}>
            {fallbackInitial}
          </Text>
        </View>
      )}
      {uploading && (
        <View style={[s.overlay, { borderRadius: radius }]}>
          <ActivityIndicator color="#FFF" />
        </View>
      )}
      {showEditPill && !uploading && (
        <View style={s.editBadge}>
          <Ionicons name="camera" size={12} color="#FFF" />
        </View>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  // No overflow:hidden — the Edit pill sits on the bottom-right outside
  // the circle's visual edge. Image clipping is handled by its own
  // borderRadius below.
  wrap: {
    position: "relative",
  },
  image: {
    // Dimensions injected via inline style based on size prop.
  },
  placeholder: {
    backgroundColor: C.surfaceRaised,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  initial: {
    fontWeight: "700",
    color: C.textPrimary,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  // Tighter badge dims around the camera icon — pulls the affordance
  // out of the photo's chin overlap reported on device review.
  editBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    backgroundColor: C.accent,
    borderRadius: 12,
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#0B0F14",
  },
});

// Suppress unused warning if Text import is dropped in future refactors.
void Text;
