// Chat message row.
// Phase C.4 redesign:
//  - Removed persistent ⋮ icon. Long-press the row to open action menu
//    (edit/delete for own, report for others'). Anchored at smiley
//    position (consistent location below the row).
//  - Smiley is now functional — tap opens ReactionPicker.
//  - Optional grouping: when `isGrouped`, hide avatar+name and just
//    indent the body to its normal position (5-min same-author cluster).
//  - Self messages get a subtle blue background tint.
//  - ReactionPills below body when reactions exist.

import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { ChatMessage } from "../types/database";
import type { Reactor } from "../hooks/useActivityFeed";
import type { AnchorPosition } from "./MessageActionMenu";
import { ReactionPills } from "./ReactionPills";
import { formatName, getInitial } from "../lib/displayName";
import { getSignedUrl } from "../lib/photoUpload";

interface Props {
  message: ChatMessage & {
    author: {
      id: string;
      display_name: string;
      avatar_url: string | null;
    };
    reactions: Reactor[];
  };
  currentUserId: string | undefined;
  isGrouped?: boolean;
  onActionMenuOpen?: (message: ChatMessage, anchor: AnchorPosition) => void;
  onOpenPicker?: (messageId: string, anchor: AnchorPosition) => void;
  onToggleReaction?: (messageId: string, emoji: string) => void;
}

export function ChatMessageRow({
  message,
  currentUserId,
  isGrouped = false,
  onActionMenuOpen,
  onOpenPicker,
  onToggleReaction,
}: Props) {
  const isMe = message.user_id === currentUserId;
  const router = useRouter();
  const authorName = formatName(message.author.display_name);
  const initial = getInitial(authorName);
  const showActions = !message.is_deleted;

  // Pass C-revised: resolve photo_url to a signed URL. Optimistic rows
  // carry a local file:// URI in photo_url during upload — pass it
  // through directly. Real rows store a Storage path that we sign.
  const photoRaw = message.photo_url ?? null;
  const isLocalPhoto = !!photoRaw && photoRaw.startsWith("file:");
  const [signedPhotoUrl, setSignedPhotoUrl] = useState<string | null>(
    isLocalPhoto ? photoRaw : null,
  );
  useEffect(() => {
    if (!photoRaw) {
      setSignedPhotoUrl(null);
      return;
    }
    if (photoRaw.startsWith("file:")) {
      setSignedPhotoUrl(photoRaw);
      return;
    }
    let alive = true;
    getSignedUrl(photoRaw)
      .then((url) => {
        if (alive) setSignedPhotoUrl(url);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [photoRaw]);

  // Smiley wrapper — measureInWindow anchors the reaction picker.
  const smileyRef = useRef<View>(null);

  // Latest touch coords on the row, captured in onTouchStart and consumed
  // by onLongPress. Pressable doesn't expose touch coords on its
  // onLongPress callback, so we capture in the touch-start phase and
  // read on long-press fire. The action menu anchors to this point
  // (rather than to the smiley) so the menu appears near the user's
  // finger regardless of where on the row they pressed.
  const lastTouchRef = useRef<{ x: number; y: number } | null>(null);

  const handleSmileyPress = () => {
    if (!onOpenPicker) return;
    smileyRef.current?.measureInWindow((x, y, width, height) => {
      onOpenPicker(message.id, { x, y, width, height });
    });
  };

  const handleLongPress = () => {
    if (!onActionMenuOpen || message.is_deleted) return;
    const touch = lastTouchRef.current;
    if (!touch) return;
    // Strip joined display fields so the menu callback sees a value
    // matching the `ChatMessage` interface exactly.
    const { author: _author, reactions: _reactions, ...base } = message;
    void _author;
    void _reactions;
    // width/height of 0 signals coordinate-mode anchoring to
    // MessageActionMenu — it centers under (touch.x, touch.y) with
    // edge clamping.
    onActionMenuOpen(base, { x: touch.x, y: touch.y, width: 0, height: 0 });
  };

  const SmileyButton = showActions ? (
    <View ref={smileyRef} style={s.smileyContainer}>
      <Pressable
        onPress={handleSmileyPress}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={({ pressed }) => [pressed && { opacity: 0.6 }]}
      >
        <Ionicons name="happy-outline" size={18} color="#8A8A8E" />
      </Pressable>
    </View>
  ) : null;

  return (
    <Pressable
      style={({ pressed }) => [
        s.row,
        isMe && s.rowSelf,
        isGrouped && s.rowGrouped,
        pressed && message.is_deleted ? null : null,
      ]}
      onTouchStart={(e) => {
        lastTouchRef.current = {
          x: e.nativeEvent.pageX,
          y: e.nativeEvent.pageY,
        };
      }}
      onLongPress={handleLongPress}
      delayLongPress={350}
      android_disableSound
    >
      {isGrouped ? (
        <View style={s.avatarSpacer} />
      ) : (
        <Pressable
          style={s.avatar}
          onPress={() => {
            router.push(`/user/${message.user_id}` as any);
          }}
          hitSlop={4}
          accessibilityRole="button"
        >
          {message.author.avatar_url ? (
            <Image
              source={{ uri: message.author.avatar_url }}
              style={s.avatarImage}
            />
          ) : (
            <Text style={s.avatarInitial}>{initial}</Text>
          )}
        </Pressable>
      )}
      <View style={s.content}>
        {!isGrouped && (
          <View style={s.headerRow}>
            <Text style={[s.name, isMe && s.nameSelf]} numberOfLines={1}>
              {authorName}
            </Text>
          </View>
        )}
        <View style={s.bodyRow}>
          <View style={s.bodyCol}>
            {message.is_deleted ? (
              <Text style={s.deletedBody}>[message deleted]</Text>
            ) : (
              <>
                {message.body.length > 0 ? (
                  <Text style={s.body}>
                    {message.body}
                    {message.edited_at ? (
                      <Text style={s.edited}> (edited)</Text>
                    ) : null}
                  </Text>
                ) : null}
              </>
            )}
          </View>
        </View>
        {/* Pass C-revised: chat-attached photo. Renders below the body so
            text + photo combinations read top-down. Optimistic rows show
            the local file URI immediately; the Storage-path signed URL
            replaces it once the real row arrives. */}
        {!message.is_deleted && signedPhotoUrl ? (
          <View style={s.photoWrap}>
            <Image
              source={{ uri: signedPhotoUrl }}
              style={s.photo}
              resizeMode="contain"
            />
          </View>
        ) : null}
        {!message.is_deleted && message.reactions.length > 0 && (
          <ReactionPills
            reactions={message.reactions}
            currentUserId={currentUserId}
            onToggle={(emoji) =>
              onToggleReaction?.(message.id, emoji)
            }
          />
        )}
      </View>
      {/* Smiley sits at the row level (sibling of avatar + content) so its
          vertical position is anchored to the row's paddingTop + the
          avatar's marginTop. This keeps the smiley column rhythmically
          consistent across grouped runs regardless of whether headerRow
          is rendered or how many lines body wraps to. */}
      {SmileyButton}
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    alignItems: "flex-start",
  },
  rowSelf: {
    backgroundColor: "rgba(10, 132, 255, 0.06)",
  },
  // Grouped continuation rows still need ~6pt of vertical breathing room
  // so the per-row smileys distribute rhythmically across the group's
  // vertical extent instead of clumping into a stuttering vertical stack.
  // Tighter than non-grouped (8pt) so the messages still read as a unit,
  // but loose enough that smiley-icon spacing feels even.
  rowGrouped: {
    paddingTop: 6,
    paddingBottom: 6,
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
  avatarSpacer: {
    width: 32,
    height: 0,
    marginRight: 12,
  },
  avatarImage: {
    width: 32,
    height: 32,
    borderRadius: 16,
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
  // edge, regardless of grouping state.
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
  bodyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  bodyCol: {
    flex: 1,
  },
  body: {
    fontSize: 15,
    color: "#FFFFFF",
    lineHeight: 20,
    marginTop: 1,
  },
  deletedBody: {
    fontSize: 15,
    fontStyle: "italic",
    color: "#8A8A8E",
    marginTop: 1,
  },
  edited: {
    fontSize: 11,
    color: "#8A8A8E",
  },
  // Chat photo attachment. Slightly narrower than full-bleed feed photos
  // (which use s.victoryPhotoWrap aspectRatio: 4/5) — chat photos are
  // conversational, not posed, so a wider max-width with native ratio
  // reads more naturally.
  photoWrap: {
    marginTop: 6,
    borderRadius: 12,
    overflow: "hidden",
    maxWidth: 240,
  },
  photo: {
    width: 240,
    aspectRatio: 1,
  },
});
