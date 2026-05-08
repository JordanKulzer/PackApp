// Modal mutation flag (Pass 21c-followup).
//
// Read-only modals (currently: app/user/[id].tsx) signal to their parent
// screen that the modal dismiss requires no refetch. Mutating modals (Pack
// Edit, Pack Create, Paywall) don't set the flag — their parent's
// useFocusEffect refetches as established in Pass 20a-f.
//
// Mechanism: read-only modal calls useSuppressParentRefetchOnDismiss(),
// which schedules the flag flip on unmount cleanup. The parent's
// useFocusEffect calls consumeSuppressFlag() at the top of its callback —
// when true, skip the focus-side effect and reset; when false, run as
// before.
//
// Lifecycle ordering (verified via the existing Pass 20a-f flow): modal
// unmount cleanup runs BEFORE the parent's focus event fires. The flag
// set in cleanup is reliably consumed by the very next focus callback.
//
// This is an intermediate solution; a TanStack-Query / realtime migration
// supersedes this whole mechanism by handling cache invalidation natively.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

interface ModalMutationContextValue {
  markReadOnlyDismiss: () => void;
  consumeReadOnlyDismiss: () => boolean;
}

const Ctx = createContext<ModalMutationContextValue>({
  markReadOnlyDismiss: () => {},
  consumeReadOnlyDismiss: () => false,
});

export function ModalMutationProvider({ children }: { children: ReactNode }) {
  const flagRef = useRef(false);
  const value = useMemo<ModalMutationContextValue>(
    () => ({
      markReadOnlyDismiss: () => {
        flagRef.current = true;
      },
      consumeReadOnlyDismiss: () => {
        const v = flagRef.current;
        flagRef.current = false;
        return v;
      },
    }),
    [],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Read-only modals call this once in their body. The cleanup function runs
// on unmount (the dismiss event), flipping the flag so the parent's next
// focus callback skips its refetch / reset side effects.
//
// Returns a cancelOnNav() function for the deep-link case (Pass 21d): if
// the modal is dismissing because the user tapped an in-modal link to
// navigate ELSEWHERE (not back to the parent that opened it), the
// destination screen needs to refetch normally on its first focus. Call
// cancelOnNav() before router.push() — the cleanup becomes a no-op so the
// flag stays false, the destination's focus event runs unsuppressed.
//
// Why this lives in the hook (not as a context-level clearSuppressFlag):
// the hook's cleanup unconditionally fires on unmount. Calling a separate
// "clear" method before dismiss only zeroes the flag transiently — the
// cleanup later re-sets it. Gating the cleanup itself via a ref is the
// only correct fix.
export function useSuppressParentRefetchOnDismiss() {
  const { markReadOnlyDismiss } = useContext(Ctx);
  const shouldSuppressRef = useRef(true);
  useEffect(
    () => () => {
      if (shouldSuppressRef.current) markReadOnlyDismiss();
    },
    [markReadOnlyDismiss],
  );
  return useCallback(() => {
    shouldSuppressRef.current = false;
  }, []);
}

// Parent useFocusEffect callbacks call this at the top. When the previous
// dismiss came from a read-only modal, returns true — caller should skip
// its effect for one cycle. Returns false otherwise (default behavior).
export function useConsumeSuppressFlag() {
  return useContext(Ctx).consumeReadOnlyDismiss;
}
