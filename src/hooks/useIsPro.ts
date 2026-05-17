import { useState, useEffect, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getCustomerInfo } from "../lib/revenuecat";
import { FREE_PACK_LIMIT, LEGACY_PACK_LIMIT } from "../lib/revenuecat";

const LEGACY_PRODUCT_ID = "pack_pro_lifetime";

// TESTING — local Pro override. Persisted to AsyncStorage so the flag
// survives restarts during QA. Override-toward-true only: a real Pro
// user is unaffected. Will be removed before public launch.
const PRO_OVERRIDE_KEY = "pack:dev:pro_override";

let proOverride = false;
const overrideListeners = new Set<() => void>();

function notifyOverride(): void {
  overrideListeners.forEach((fn) => fn());
}

AsyncStorage.getItem(PRO_OVERRIDE_KEY)
  .then((raw) => {
    proOverride = raw === "1";
    notifyOverride();
  })
  .catch(() => {});

export function setProOverride(value: boolean): void {
  proOverride = value;
  AsyncStorage.setItem(PRO_OVERRIDE_KEY, value ? "1" : "0").catch(() => {});
  notifyOverride();
}

function subscribeOverride(cb: () => void): () => void {
  overrideListeners.add(cb);
  return () => {
    overrideListeners.delete(cb);
  };
}

function getOverrideSnapshot(): boolean {
  return proOverride;
}

export function useProOverride(): boolean {
  return useSyncExternalStore(
    subscribeOverride,
    getOverrideSnapshot,
    getOverrideSnapshot,
  );
}

interface IsProState {
  isPro: boolean;
  isLoading: boolean;
  effectivePackLimit: number;
}

export function useIsPro(): IsProState {
  const override = useProOverride();
  const [state, setState] = useState<IsProState>({
    isPro: false,
    isLoading: true,
    effectivePackLimit: FREE_PACK_LIMIT,
  });

  useEffect(() => {
    let cancelled = false;
    getCustomerInfo()
      .then((info) => {
        if (cancelled) return;
        const proActive = !!info.entitlements.active["pro"];
        const hasLegacy = info.nonSubscriptionTransactions.some(
          (t) => t.productIdentifier === LEGACY_PRODUCT_ID
        );
        setState({
          isPro: proActive || hasLegacy,
          isLoading: false,
          effectivePackLimit: proActive
            ? Infinity
            : hasLegacy
              ? LEGACY_PACK_LIMIT
              : FREE_PACK_LIMIT,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setState({ isPro: false, isLoading: false, effectivePackLimit: FREE_PACK_LIMIT });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Override layers on top: real Pro → unchanged; override-only → mirrors
  // the real-Pro shape (effectivePackLimit = Infinity) so every gate that
  // reads either field sees consistent Pro treatment.
  if (override && !state.isPro) {
    return {
      isPro: true,
      isLoading: state.isLoading,
      effectivePackLimit: Infinity,
    };
  }
  return state;
}
