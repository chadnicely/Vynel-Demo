import { onBeforeUnmount, ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import { useVynel } from "../use-vynel.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// The app's ONE GitHub connection (global — Settings → GitHub, the wizard's
// account step): the `gh` sign-in state, the in-app device-flow sign-in, and
// the sign-out. Vynel never sees the token; `gh` keeps it.

export const githubKeys = {
  connection: ["github-connection"] as const,
};

export type GitHubConnectionStatus = Awaited<
  ReturnType<VynelClient["github"]["getConnection"]>
>;
export type GitHubSignInState = Awaited<
  ReturnType<VynelClient["github"]["beginSignIn"]>
>;

export function useGitHubConnection(enabled: () => boolean = () => true) {
  const vynel = useVynel();
  return useQuery({
    queryKey: githubKeys.connection,
    queryFn: () => vynel.github.getConnection(),
    enabled,
    staleTime: 60_000,
  });
}

const POLL_MS = 1_500;

/** Begin the sign-in, show the code + URL, poll until the CLI's verdict, and
 *  refresh the connection the moment it flips. */
export function useGitHubSignIn() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  const state = ref<GitHubSignInState | null>(null);
  const isBeginning = ref(false);
  const errorMessage = ref<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function stopPolling() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  async function poll(loginId: string) {
    try {
      const next = await vynel.github.getSignIn(loginId);
      state.value = next;
      if (next.phase === "awaiting-browser") {
        timer = setTimeout(() => void poll(loginId), POLL_MS);
        return;
      }
      if (next.phase === "signed-in") {
        await queryClient.invalidateQueries({
          queryKey: githubKeys.connection,
        });
      }
    } catch (error) {
      errorMessage.value = formatSdkError(error);
    }
  }

  async function begin() {
    stopPolling();
    errorMessage.value = null;
    isBeginning.value = true;
    try {
      const began = await vynel.github.beginSignIn();
      state.value = began;
      if (began.phase === "awaiting-browser")
        timer = setTimeout(() => void poll(began.loginId), POLL_MS);
    } catch (error) {
      errorMessage.value = formatSdkError(error);
    } finally {
      isBeginning.value = false;
    }
  }

  async function cancel() {
    stopPolling();
    const current = state.value;
    state.value = null;
    if (current?.phase === "awaiting-browser") {
      try {
        await vynel.github.cancelSignIn(current.loginId);
      } catch (error) {
        errorMessage.value = formatSdkError(error);
      }
    }
  }

  onBeforeUnmount(stopPolling);

  return { state, isBeginning, errorMessage, begin, cancel };
}

export function useGitHubSignOut() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => vynel.github.signOut(),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: githubKeys.connection }),
  });
}
