import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { type MaybeRefOrGetter, toValue } from "vue";
import { useVynel } from "../use-vynel.js";

// Signing a remote engine in to the user's Claude account. Vynel only relays:
// the server's own CLI prints the link and writes its own credential file, so
// no token ever passes through here.

interface ClaudeAuthState {
  phase: "awaiting-authorization" | "finishing" | "signed-in" | "failed";
  authorizationUrl: string | null;
  errorMessage: string | null;
}

interface RemoteClaudeAuthStatus {
  isSignedIn: boolean;
  detail: string;
}

export function claudeAuthKeys(installId: string) {
  return ["server-installs", installId, "claude-auth"] as const;
}

/** Whether the server is already signed in — read before offering sign-in. */
export function useRemoteClaudeAuthStatus(
  installId: MaybeRefOrGetter<string>,
  enabled: MaybeRefOrGetter<boolean>,
) {
  const vynel = useVynel();
  return useQuery({
    queryKey: ["server-installs", "claude-auth", installId] as const,
    queryFn: async () =>
      (await vynel.serverInstall.getClaudeAuthStatus(
        toValue(installId),
      )) as RemoteClaudeAuthStatus,
    enabled,
    retry: false,
  });
}

/** Begin sign-in; resolves with the link the user opens in their browser. */
export function useStartClaudeAuth() {
  const vynel = useVynel();
  return useMutation({
    mutationFn: async (input: { installId: string }) =>
      (await vynel.serverInstall.startClaudeAuth(input.installId)) as ClaudeAuthState,
  });
}

/** Hand the server the code the user pasted back from their browser. */
export function useSubmitClaudeAuthCode() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { installId: string; code: string }) =>
      (await vynel.serverInstall.submitClaudeAuthCode(input.installId, {
        code: input.code,
      })) as ClaudeAuthState,
    onSuccess: (_state, input) =>
      queryClient.invalidateQueries({
        queryKey: ["server-installs", "claude-auth", input.installId],
      }),
  });
}
