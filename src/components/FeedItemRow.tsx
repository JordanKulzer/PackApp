// FeedItemRow — activity event row in the unified Chat timeline.
// Phase C.4 redesign: same horizontal rhythm as ChatMessageRow (avatar +
// name header + action line below), inline pts pill, smiley anchored
// ReactionPicker, ReactionPills below the action line.
//
// Photo handling stays for daily_winner victory posts (signed URL fetch,
// fullscreen viewer, photo-level long-press menu for delete/report). The
// daily_winner feature is currently flag-gated off, so the photo path is
// dormant in practice — but kept functional.
//
// System-shape activity types (took_lead, all_goals) route to
// SystemMessageRow via TimelineRow, NOT through this component.

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Image,
  Alert,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { FeedItem } from "../hooks/useActivityFeed";
import type { AnchorPosition } from "./MessageActionMenu";
import { ReactionPills } from "./ReactionPills";
import { useCurrentUser } from "../context/CurrentUserContext";
import { formatName, getInitial } from "../lib/displayName";
import type { ActivityCategory } from "../lib/activityCategoryMap";
import {
  getSignedUrl,
  deletePhoto,
  reportPhoto,
} from "../lib/photoUpload";

const REPORT_REASONS = [
  "Inappropriate",
  "Spam",
  "Nudity",
  "Violence",
] as const;
const WATER_TARGET_FALLBACK = 64;

interface Props {
  item: FeedItem;
  currentUserId: string | undefined;
  onToggleReaction: (feedItemId: string, emoji: string) => void;
  onOpenPicker: (item: FeedItem, anchor: AnchorPosition) => void;
  removePhotoFromItem: (id: string) => void;
}

function ManualBadge() {
  return (
    <View style={s.manualBadge}>
      <Text style={s.manualBadgeText}>M</Text>
    </View>
  );
}

// Category-driven verb phrases for workout rows. 'other' (and any unknown
// category from a legacy NULL row) falls back to "logged a workout".
const WORKOUT_VERBS: Record<ActivityCategory, string> = {
  running: "ran",
  walking: "walked",
  hiking: "hiked",
  cycling: "biked",
  swimming: "swam",
  strength_training: "lifted",
  yoga: "did yoga",
  pilates: "did pilates",
  hiit: "did HIIT",
  climbing: "climbed",
  rowing: "rowed",
  team_sports: "played a team sport",
  racquet_sports: "played a racquet sport",
  dance: "danced",
  other: "logged a workout",
};

function actionPhrase(item: FeedItem): string {
  switch (item.activityType) {
    case "steps":
      return `logged ${item.value.toLocaleString()} steps`;
    case "workout":
      return WORKOUT_VERBS[item.category ?? "other"] ?? "logged a workout";
    case "calories":
      return `burned ${item.value.toLocaleString()} active calories`;
    case "water":
      // Third-person language is universal — self-row background tint
      // already signals "this is yours" without needing first-person.
      return item.value >= WATER_TARGET_FALLBACK
        ? "hit their water goal"
        : `logged ${item.value} oz of water`;
    case "daily_winner":
      return "🏆 won yesterday";
    case "took_lead":
      // Pass 25-followup-E.2.b.iii-fix-2: photo-bearing took_lead rows
      // route here (TimelineRow conditional routing); the matching phrase
      // mirrors SystemMessageRow's tone for cross-surface consistency.
      return "took the lead 👑";
    // ── Intentional-sharing Phase 2: manual-share variants ──────────
    // Rendered by FeedItemRow as a normal feed row (NOT system-style —
    // these are user-initiated social posts). Copy reads as the
    // person's actual activity, not as telemetry — the row should
    // feel like a post, not a debug label. "shared their X" reads
    // robotic ("Jordan shared their 412 calories"); we use the verb
    // for the action instead ("Jordan burned 412 calories today" /
    // "Jordan did yoga").
    case "steps_share":
      return `took ${item.value.toLocaleString()} steps today`;
    case "calories_share":
      return `burned ${item.value.toLocaleString()} calories today`;
    case "water_share":
      return `drank ${item.value} oz of water today`;
    case "workout_share":
      // Reuse WORKOUT_VERBS for the category when known. "other" /
      // missing category lands on a plain "did a workout" — better
      // than the WORKOUT_VERBS["other"] = "logged a workout" fallback,
      // which leaks the old logging framing into share rows.
      if (item.category && item.category !== "other") {
        return WORKOUT_VERBS[item.category];
      }
      return "did a workout";
    default:
      // all_goals etc. route to SystemMessageRow; this fallback covers any
      // unknown future type.
      return `completed ${item.activityType}`;
  }
}

export function FeedItemRow({
  item,
  currentUserId,
  onToggleReaction,
  onOpenPicker,
  removePhotoFromItem,
}: Props) {
  const [signedPhotoUrl, setSignedPhotoUrl] = useState<string | null>(null);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [photoMenuOpen, setPhotoMenuOpen] = useState(false);
  const [reportMenuOpen, setReportMenuOpen] = useState(false);

  const { user: currentUser } = useCurrentUser();
  const router = useRouter();
  const isMe = item.userId === currentUserId;
  const resolvedName =
    isMe && currentUser ? currentUser.displayName : item.displayName;
  const resolvedAvatar =
    isMe && currentUser ? currentUser.avatarUrl : item.avatarUrl;
  const name = formatName(resolvedName, 0);
  const initial = getInitial(resolvedName);

  const smileyRef = React.useRef<View>(null);

  useEffect(() => {
    if (!item.photoUrl) {
      setSignedPhotoUrl(null);
      return;
    }
    getSignedUrl(item.photoUrl)
      .then((url) => setSignedPhotoUrl(url))
      .catch(() => {});
  }, [item.photoUrl]);

  const handleDeletePhoto = async () => {
    setPhotoMenuOpen(false);
    if (item.photoUrl) {
      deletePhoto(item.photoUrl).catch(() => {});
    }
    removePhotoFromItem(item.id);
  };

  const handleReport = (reason: string) => {
    setReportMenuOpen(false);
    if (currentUserId && item.photoUrl) {
      reportPhoto(currentUserId, item.id, item.photoUrl, reason).catch(
        () => {},
      );
      Alert.alert(
        "Reported",
        "Thanks for letting us know. We'll review this photo.",
      );
    }
  };

  const handleSmileyPress = () => {
    smileyRef.current?.measureInWindow((x, y, width, height) => {
      onOpenPicker(item, { x, y, width, height });
    });
  };

  const phrase = actionPhrase(item);

  return (
    <View style={[s.row, s.rowActivity]}>
      <TouchableOpacity
        style={s.avatar}
        onPress={() => {
          router.push(`/user/${item.userId}` as any);
        }}
        activeOpacity={0.7}
        accessibilityRole="button"
      >
        {resolvedAvatar ? (
          <Image
            source={{ uri: resolvedAvatar }}
            style={{ width: 32, height: 32, borderRadius: 16 }}
          />
        ) : (
          <Text style={s.avatarInitial}>{initial}</Text>
        )}
      </TouchableOpacity>
      <View style={s.content}>
        <View style={s.headerRow}>
          <Text
            style={[s.name, isMe && s.nameSelf]}
            numberOfLines={1}
          >
            {name}
          </Text>
        </View>
        <View style={s.actionLine}>
          <Text style={s.action} numberOfLines={2}>
            {phrase}
          </Text>
        </View>

        {/* Photo — daily_winner + took_lead use the larger victory-style
            wrap (Pass 25-followup-E.2.b.iii-fix-2 extends took_lead to
            match daily_winner's share-worthy framing). */}
        {signedPhotoUrl && (
          <TouchableOpacity
            style={
              item.activityType === "daily_winner" ||
              item.activityType === "took_lead"
                ? s.victoryPhotoWrap
                : s.photoWrap
            }
            onPress={() => setFullscreenOpen(true)}
            onLongPress={() =>
              isMe ? setPhotoMenuOpen(true) : setReportMenuOpen(true)
            }
            activeOpacity={0.92}
          >
            <Image
              source={{ uri: signedPhotoUrl }}
              style={s.photo}
              resizeMode="cover"
            />
          </TouchableOpacity>
        )}

        {/* Caption — render whenever the row has one, regardless of
            activityType. Phase 2 fix B: the prior gate restricted this
            to daily_winner + took_lead, which silently swallowed
            captions on _share rows. A type-gated caption is fragile
            (every new captioned activity_type has to remember to
            update the gate); "show the caption if there is one" is
            the correct rule and is retroactively correct for the
            existing gated types too. */}
        {item.caption ? (
          <Text style={s.caption}>{item.caption}</Text>
        ) : null}

        <ReactionPills
          reactions={item.reactions}
          currentUserId={currentUserId}
          onToggle={(emoji) => onToggleReaction(item.id, emoji)}
        />
      </View>
      {/* Smiley sits at the row level (sibling of avatar + content) so its
          vertical position is anchored to the row's paddingTop + the
          avatar's marginTop — same y-offset as the avatar TOP. Keeps the
          smiley rhythm consistent with ChatMessageRow when activity
          events are interleaved with chat messages. */}
      <View ref={smileyRef} style={s.smileyContainer}>
        <Pressable
          onPress={handleSmileyPress}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={({ pressed }) => [pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="happy-outline" size={18} color="#8A8A8E" />
        </Pressable>
      </View>

      {/* Fullscreen photo viewer */}
      {fullscreenOpen && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setFullscreenOpen(false)}
        >
          <Pressable
            style={s.fullscreenOverlay}
            onPress={() => setFullscreenOpen(false)}
          >
            <Image
              source={{ uri: signedPhotoUrl ?? "" }}
              style={s.fullscreenImage}
              resizeMode="contain"
            />
          </Pressable>
        </Modal>
      )}

      {/* Photo context menu (own) */}
      {photoMenuOpen && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setPhotoMenuOpen(false)}
        >
          <Pressable
            style={s.sheetOverlay}
            onPress={() => setPhotoMenuOpen(false)}
          >
            <Pressable style={s.contextSheet}>
              <View style={s.sheetHandle} />
              <TouchableOpacity
                style={s.contextRow}
                onPress={handleDeletePhoto}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="trash-outline"
                  size={18}
                  color="#F87171"
                />
                <Text
                  style={[s.contextRowText, { color: "#F87171" }]}
                >
                  Delete photo
                </Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Photo report menu (others') */}
      {reportMenuOpen && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setReportMenuOpen(false)}
        >
          <Pressable
            style={s.sheetOverlay}
            onPress={() => setReportMenuOpen(false)}
          >
            <Pressable style={s.contextSheet}>
              <View style={s.sheetHandle} />
              <Text style={s.reportTitle}>Report photo</Text>
              {REPORT_REASONS.map((reason, i) => (
                <React.Fragment key={reason}>
                  <TouchableOpacity
                    style={s.contextRow}
                    onPress={() => handleReport(reason)}
                    activeOpacity={0.7}
                  >
                    <Text style={s.contextRowText}>{reason}</Text>
                  </TouchableOpacity>
                  {i < REPORT_REASONS.length - 1 && (
                    <View style={s.contextDivider} />
                  )}
                </React.Fragment>
              ))}
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: "flex-start",
  },
  // Activity rows always carry a raised-surface tint so they read as
  // system events distinct from chat messages (which stay transparent
  // for non-self, blue-tinted for self). Replaces the prior self-tint
  // override — identity in activity rows is conveyed by avatar + name,
  // not by the row background.
  rowActivity: {
    backgroundColor: "#121821",
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#1C2333",
    marginRight: 12,
    marginTop: 2,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarInitial: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 13,
  },
  content: {
    flex: 1,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  // Smiley sits as a row-level sibling of avatar + content. marginTop
  // matches the avatar's marginTop (2pt) so the smiley TOP aligns with
  // the avatar's TOP — both anchored at row.paddingTop + 2 from the row
  // edge. Matches the ChatMessageRow rule for cross-row-type rhythm.
  smileyContainer: {
    marginLeft: 8,
    marginTop: 2,
  },
  name: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFFFFF",
    flexShrink: 1,
  },
  nameSelf: {
    color: "#0A84FF",
  },
  actionLine: {
    marginTop: 1,
  },
  action: {
    fontSize: 14,
    color: "#9CA3AF",
    lineHeight: 19,
  },
  manualBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: "#2C2C2E",
  },
  manualBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#8A8A8E",
  },

  // Photo (daily_winner)
  photoWrap: {
    marginTop: 8,
    borderRadius: 12,
    overflow: "hidden",
  },
  victoryPhotoWrap: {
    marginTop: 8,
    borderRadius: 12,
    overflow: "hidden",
    aspectRatio: 4 / 5,
  },
  photo: {
    width: "100%",
    aspectRatio: 4 / 5,
  },
  caption: {
    marginTop: 6,
    fontSize: 13,
    color: "#E6EDF3",
    fontStyle: "italic",
  },

  // Modals
  fullscreenOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    justifyContent: "center",
    alignItems: "center",
  },
  fullscreenImage: {
    width: "100%",
    height: "80%",
  },
  sheetOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  contextSheet: {
    backgroundColor: "#1C1C1E",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 8,
    paddingBottom: 32,
    paddingHorizontal: 16,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#3A3A3C",
    alignSelf: "center",
    marginBottom: 12,
  },
  contextRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    gap: 10,
  },
  contextRowText: {
    fontSize: 16,
    color: "#FFFFFF",
  },
  contextDivider: {
    height: 1,
    backgroundColor: "#2C2C2E",
  },
  reportTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#8A8A8E",
    marginBottom: 4,
  },
});
