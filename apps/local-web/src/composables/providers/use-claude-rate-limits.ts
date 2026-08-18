import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

// The account's limit windows (the popup's Limits tab): the engine's own
// readings, persisted per turn — so a fresh read matters every time the tab
// opens (no stale time; a reading can land mid-dialog).
export const claudeRateLimitKeys = {
  all: ["claude-rate-limits"] as const,
};

export function useClaudeRateLimits(enabled: () => boolean) {
  const vynel = useVynel();
  return useQuery({
    queryKey: claudeRateLimitKeys.all,
    queryFn: () => vynel.providers.listRateLimits("claude"),
    enabled,
  });
}
