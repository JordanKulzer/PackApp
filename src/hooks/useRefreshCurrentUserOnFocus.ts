import { useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { useCurrentUser } from "../context/CurrentUserContext";

export function useRefreshCurrentUserOnFocus() {
  const { refresh } = useCurrentUser();
  useFocusEffect(
    useCallback(() => {
      console.log('[FocusHook] fired at', new Date().toISOString().slice(11, 23));
      refresh();
    }, [refresh]),
  );
}
