import { useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { useCurrentUser } from "../context/CurrentUserContext";

export function useRefreshCurrentUserOnFocus() {
  const { refresh } = useCurrentUser();
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );
}
