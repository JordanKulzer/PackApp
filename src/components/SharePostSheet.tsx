// Intentional-sharing Phase 2 — the Share composer.
//
// Full-screen modal (NOT a partial bottom sheet). Composing a post —
// pick photo, type caption, review, submit — is a content-creation
// task and gets the whole canvas. Matches the app's existing full-
// screen modal pattern (see WeekDetailSheet: <Modal animationType="slide">
// + opaque container + safe-area-aware header).
//
// Container shape:
//   - <Modal visible animationType="slide" onRequestClose={close}>
//   - Opaque full-screen container (flex: 1, backgroundColor: C.bg)
//   - Top bar with title + close (X). No drag handle.
//   - ScrollView holds the SCROLLABLE content (context pill + photo
//     control). A tall photo preview needs to scroll, so it lives here.
//   - KeyboardStickyView wraps the caption + counter + Post BLOCK and
//     pins it above the keyboard when one opens. This is the same
//     pattern the chat composer uses (pack/[id].tsx ChatInputBar) and
//     the codebase already proved RN's KeyboardAvoidingView is the
//     wrong tool for this shape — see the comment at the ChatInputBar
//     KeyboardStickyView ("KeyboardAvoidingView hid the input
//     entirely when the keyboard opened").
//
// Post-logic carry-over from before — unchanged:
//   - ShareContext shape + photo-optional canPost rule.
//   - handlePickPhoto (ActionSheet) + pickFromLibrary / takeWithCamera.
//   - handlePost → createSharePost → INSERT → upload → UPDATE pattern.
//   - 140-char caption input + counter.
//
// Photo preview renders at the photo's NATIVE aspect ratio (Image.getSize),
// capped at maxHeight 360 so a very tall portrait doesn't dominate.
// resizeMode="contain" — no crop here. (The separate upload-side stretch
// bug — uploadVictoryPhoto's square-resize — is NOT fixed in this prompt;
// after that fix lands, this preview already reads the correct ratio.)

import React, { useEffect, useState } from "react";
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
  Platform,
  ActionSheetIOS,
  ScrollView,
} from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
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

// Copy pass: a single neutral title ("Share your activity") across all
// four kinds. The earlier per-kind titles read awkwardly for some
// kinds ("Share your calories" — you don't share calories, you share
// that you burned them). The contextPill below carries the specifics
// (e.g. "412 cal · {packName}") so the kind is still legible without
// the title trying to verb it.
const HEADER_COPY: Record<
  ShareKind,
  { title: string; subtitleTemplate: string }
> = {
  steps_share: {
    title: "Share your activity",
    subtitleTemplate: "{value} steps · {packName}",
  },
  workout_share: {
    title: "Share your activity",
    // {category} interpolates the display name (e.g. "Yoga"), falling
    // back to "Workout" when no category was passed.
    subtitleTemplate: "{category} · {packName}",
  },
  calories_share: {
    title: "Share your activity",
    subtitleTemplate: "{value} cal · {packName}",
  },
  water_share: {
    title: "Share your activity",
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
  // Source pixel dimensions from the picker (expo-image-picker returns
  // these on every asset). Threaded to createSharePost so the activity_feed
  // row carries photo_aspect at INSERT time — FeedItemRow then renders the
  // photo at the correct ratio synchronously instead of after a second
  // Image.getSize round-trip on read.
  const [localDims, setLocalDims] = useState<
    { width: number; height: number } | null
  >(null);
  const [caption, setCaption] = useState("");
  const [posting, setPosting] = useState(false);
  // Native aspect ratio of the picked photo, read via Image.getSize.
  // Drives the preview's aspectRatio so portrait/landscape both render
  // truthfully (no 4:5 cover crop). Falls back to 1 (square) for the
  // first frame while getSize is in flight.
  const [photoAspect, setPhotoAspect] = useState<number | null>(null);

  const charsLeft = 140 - caption.length;
  const counterColor = charsLeft <= 10 ? "#ef4444" : C.textTertiary;

  useEffect(() => {
    if (!localUri) {
      setPhotoAspect(null);
      return;
    }
    Image.getSize(
      localUri,
      (w, h) => {
        if (w > 0 && h > 0) setPhotoAspect(w / h);
      },
      () => {
        // getSize can fail on some URIs; default to square — the
        // preview renders, just without true ratio. Not a hard failure.
        setPhotoAspect(1);
      },
    );
  }, [localUri]);

  // Post enabled when at least one of {photo, caption} is set. Both
  // empty is the only blocked state — sharing nothing is not a thing.
  const canPost = (!!localUri || caption.trim().length > 0) && !posting;

  const handlePickPhoto = () => {
    const pick = async (picker: typeof pickFromLibrary) => {
      const photo = await picker();
      if (photo) {
        setLocalUri(photo.uri);
        setLocalDims({ width: photo.width, height: photo.height });
      }
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
    const ok = await createSharePost(
      share,
      trimmedCaption,
      localUri,
      localDims,
    );

    if (!ok) {
      Alert.alert("Failed to post", "Please try again.");
      setPosting(false);
      return;
    }

    setPosting(false);
    setLocalUri(null);
    setLocalDims(null);
    setCaption("");
    onPosted();
    onDismiss();
  };

  const handleClose = () => {
    if (posting) return;
    setLocalUri(null);
    setLocalDims(null);
    setCaption("");
    onDismiss();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View style={s.container}>
        {/* Top bar — safe-area-aware. Title centered; close (X) on the
            right (modal slides up; X is the explicit dismiss control —
            no drag-down since this is a full-screen modal, not a sheet). */}
        <View style={[s.header, { paddingTop: insets.top + 12 }]}>
          <View style={s.headerSide} />
          <View style={s.headerCenter}>
            <Text style={s.title} numberOfLines={1}>
              {title}
            </Text>
          </View>
          <TouchableOpacity
            style={[s.headerSide, s.closeBtn]}
            onPress={handleClose}
            hitSlop={10}
          >
            <Ionicons name="close" size={24} color={C.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* State-aware body layout. The empty and photo-added states
            have different sizing needs — empty wants a large target
            that fills the available space; photo-added wants the
            preview to size to its native aspect ratio and be
            scrollable when tall on small devices. Branching gives
            each state the right container without one fighting the
            other through shared flex rules. */}
        {localUri ? (
          /* Photo-added state — UNCHANGED from previous prompt.
             ScrollView with gap-spaced content, preview at native
             aspect ratio capped at maxHeight: 360. Scrolls when the
             preview pushes content taller than the viewport (e.g.
             tall portrait on a small device). */
          <ScrollView
            style={s.scroll}
            contentContainerStyle={s.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
          >
            <View style={s.contextPill}>
              <Text style={s.contextPillText}>{subtitle}</Text>
            </View>
            <View
              style={[
                s.previewWrap,
                { aspectRatio: photoAspect ?? 1 },
              ]}
            >
              <Image
                source={{ uri: localUri }}
                style={s.preview}
                resizeMode="contain"
              />
              <TouchableOpacity
                style={s.previewRemove}
                onPress={() => {
                  setLocalUri(null);
                  setLocalDims(null);
                }}
                hitSlop={8}
              >
                <Ionicons name="close-circle" size={26} color="#FFF" />
              </TouchableOpacity>
            </View>
          </ScrollView>
        ) : (
          /* Empty state — large "Add photo" target. Plain column
             (no ScrollView — content is bounded by emptyTarget's
             maxHeight, no scroll needed). flex:1 on the column +
             flex:1 on the target makes the target absorb the space
             between the pill and the sticky footer; maxHeight 420
             caps it on tall devices so it stays "large + inviting"
             rather than absurdly tall. Tap opens the existing
             handlePickPhoto ActionSheet — unchanged. */
          <View style={s.emptyColumn}>
            <View style={s.contextPill}>
              <Text style={s.contextPillText}>{subtitle}</Text>
            </View>
            <TouchableOpacity
              style={s.emptyTarget}
              onPress={handlePickPhoto}
              activeOpacity={0.8}
            >
              <Ionicons
                name="camera-outline"
                size={48}
                color={C.textTertiary}
              />
              <Text style={s.emptyTargetLabel}>Add photo</Text>
              <Text style={s.emptyTargetSubtext}>Optional</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Sticky footer block — caption + counter + Post button. Pinned
            above the keyboard via KeyboardStickyView (same primitive
            ChatInputBar uses, see pack/[id].tsx ChatInputBar wrapper).
            Offset is { closed: 0, opened: 0 } — unlike the ChatTab
            launcher (which has { opened: 84 / 64 } to compensate for
            the bottom tab nav), this is a full-screen modal that
            renders ABOVE the tab nav, so no compensation is needed.
            The block carries its own bottom safe-area padding for the
            keyboard-closed state (home indicator clearance);
            KeyboardStickyView lifts the whole block above the keyboard
            when it opens. */}
        <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
          <View
            style={[s.footer, { paddingBottom: insets.bottom + 12 }]}
          >
            <TextInput
              style={s.captionInput}
              placeholder="Tell the pack about it"
              placeholderTextColor={C.textTertiary}
              value={caption}
              onChangeText={(t) => setCaption(t.slice(0, 140))}
              multiline
              maxLength={140}
            />
            <Text style={[s.charCounter, { color: counterColor }]}>
              {caption.length}/140
            </Text>
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
        </KeyboardStickyView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  // Full-screen container — opaque, edge-to-edge. Matches the
  // WeekDetailSheet container shape (Modal animationType="slide"
  // + flex:1 + bg).
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: "#0A0A0A",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  // Equal-width side slots so the title centers regardless of which
  // controls are present. Spacer on the left mirrors the closeBtn
  // on the right.
  headerSide: {
    width: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: C.textPrimary,
  },
  closeBtn: {
    height: 40,
  },
  scroll: {
    flex: 1,
  },
  // Single source of truth for inter-item spacing. The previous layout
  // had the caption + counter + Post inside this ScrollView, and items
  // carried per-item marginBottom (contextPill: 24, addPhotoRow: 16,
  // previewWrap: 16) to space themselves vs the caption block below.
  // After Phase 2 moved the caption block to a KeyboardStickyView
  // footer, those marginBottoms became trailing space — stacking to
  // a visible "dead gap" between Add photo and the sticky footer in
  // the empty state. Fix: drop the per-item marginBottoms; use
  // scrollContent.gap for inter-item spacing instead. Content flows
  // top-down naturally; any empty space sits below the last item,
  // above the footer — fine for a full-screen modal.
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    gap: 16,
  },
  contextPill: {
    alignSelf: "center",
    backgroundColor: "rgba(251,191,36,0.12)",
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.3)",
    borderRadius: 9999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  contextPillText: {
    fontSize: 13,
    fontWeight: "500",
    color: C.gold,
  },
  // Empty-state column. Plain View (no ScrollView) — the empty state
  // is bounded by emptyTarget's maxHeight and doesn't need to scroll.
  // flex:1 fills the space between header and sticky footer; mirrors
  // scrollContent's padding/gap so the pill sits the same distance
  // from the top as in the photo-added ScrollView path.
  emptyColumn: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    gap: 16,
  },
  // Large "Add photo" target. flex:1 absorbs the empty space between
  // pill and sticky footer; maxHeight 420 caps it on tall devices so
  // it stays "large + inviting" rather than absurdly tall. Dashed
  // border + tinted surface read as a tap target / drop zone. Icon +
  // label + subtext vertically centered.
  emptyTarget: {
    flex: 1,
    maxHeight: 420,
    borderWidth: 2,
    borderColor: C.border,
    borderStyle: "dashed",
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.03)",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  emptyTargetLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: C.textPrimary,
  },
  emptyTargetSubtext: {
    fontSize: 13,
    color: C.textTertiary,
  },
  // Photo-added state: full-width preview at the photo's NATIVE aspect
  // ratio (aspectRatio is set inline from photoAspect state). Capped at
  // maxHeight: 360 so a very tall portrait doesn't push the caption +
  // Post button off-screen on small devices. resizeMode="contain" on
  // the Image — no crop; the wrap's background fills any letterbox.
  previewWrap: {
    width: "100%",
    maxHeight: 360,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  preview: {
    width: "100%",
    height: "100%",
  },
  previewRemove: {
    position: "absolute",
    top: 8,
    right: 8,
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
  // Sticky footer block — caption + counter + Post. Opaque + top
  // hairline so the ScrollView content above doesn't bleed under it.
  // gap: 8 between input/counter/Post is tight enough to feel like
  // one composer block. Bottom padding is applied inline (insets.bottom + 12)
  // so the home indicator gets clearance when the keyboard is closed.
  footer: {
    backgroundColor: C.bg,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
    gap: 8,
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
