import { computed } from "vue";
import type { HubFeatureKey } from "@vynel/contracts/hub/entitlements";
import { useHubSession } from "./use-hub-session.js";

/**
 * The tier gate, derived from the hub link status. A lock exists ONLY while
 * a live entitlement is present — signed-in, or offline inside the grace
 * window (tier still known). With no entitlement (not-configured, signed-out,
 * offline past grace) nothing is gated: the UI mirrors the daemon's own
 * enforcement, so it never shows a lock the API wouldn't answer with.
 */
export function useHubFeatures() {
  const sessionQuery = useHubSession();

  const entitledFeatures = computed<readonly string[] | null>(() => {
    const status = sessionQuery.data.value;
    if (!status) return null;
    if (status.kind === "signed-in") return status.features;
    if (status.kind === "offline" && status.tier !== null) {
      return status.features;
    }
    return null;
  });

  const hasEntitlement = computed(() => entitledFeatures.value !== null);

  function isLocked(feature: HubFeatureKey): boolean {
    const features = entitledFeatures.value;
    return features !== null && !features.includes(feature);
  }

  return { hasEntitlement, isLocked };
}
