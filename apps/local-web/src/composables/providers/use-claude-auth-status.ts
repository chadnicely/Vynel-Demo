import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

// The Claude account read behind the top-bar popup: install + auth state plus
// the CLI-reported identity (email / org / plan). Short stale time — the
// state changes when the user signs in or out, and the login flow invalidates
// this key the moment a sign-in lands.
export const claudeAuthKeys = {
  status: ["claude-auth-status"] as const,
};

export function useClaudeAuthStatus(enabled: () => boolean) {
  const vynel = useVynel();
  return useQuery({
    queryKey: claudeAuthKeys.status,
    queryFn: () => vynel.providers.getAuthStatus("claude"),
    enabled,
    staleTime: 60_000,
  });
}
