import { useState, useEffect } from "react";
import { getCustomerInfo } from "../lib/revenuecat";
import { FREE_PACK_LIMIT, LEGACY_PACK_LIMIT } from "../lib/revenuecat";

const LEGACY_PRODUCT_ID = "pack_pro_lifetime";

interface IsProState {
  isPro: boolean;
  isLoading: boolean;
  effectivePackLimit: number;
}

export function useIsPro(): IsProState {
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

  return state;
}
