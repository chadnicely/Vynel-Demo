import { ref } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import { claudeAuthKeys } from "./use-claude-auth-status.js";

// The sign-in flow's client half (top-bar account popup): begin opens the
// relay and hands back the authorization URL; the user signs in in their
// browser and pastes the code back; submit waits for the CLI's own verdict.
// The credential never passes through here — the CLI writes its own file.
export type ClaudeLoginViewPhase =
  | "idle"
  | "opening"
  | "code"
  | "finishing"
  | "error";

export function useClaudeLogin() {
  const vynel = useVynel();
  const queryClient = useQueryClient();

  const phase = ref<ClaudeLoginViewPhase>("idle");
  const authorizationUrl = ref<string | null>(null);
  const errorMessage = ref<string | null>(null);
  let loginId: string | null = null;

  async function begin(): Promise<void> {
    phase.value = "opening";
    errorMessage.value = null;
    try {
      const opened = await vynel.providers.beginLogin("claude");
      loginId = opened.loginId;
      authorizationUrl.value = opened.authorizationUrl;
      phase.value = "code";
    } catch (error) {
      errorMessage.value = formatSdkError(error);
      phase.value = "error";
    }
  }

  async function submitCode(code: string): Promise<void> {
    if (loginId === null || code.trim().length === 0) return;
    phase.value = "finishing";
    try {
      await vynel.providers.submitLoginCode("claude", loginId, { code: code.trim() });
      loginId = null;
      authorizationUrl.value = null;
      phase.value = "idle";
      await queryClient.invalidateQueries({ queryKey: claudeAuthKeys.status });
    } catch (error) {
      // The server discarded the failed session — a retry begins fresh.
      loginId = null;
      errorMessage.value = formatSdkError(error);
      phase.value = "error";
    }
  }

  function cancel(): void {
    if (loginId !== null) {
      // Best-effort: an unreachable API just leaves the session to the
      // relay's own idle timer, which discards it anyway.
      void vynel.providers.cancelLogin("claude", loginId).catch(() => undefined);
      loginId = null;
    }
    authorizationUrl.value = null;
    errorMessage.value = null;
    phase.value = "idle";
  }

  return { phase, authorizationUrl, errorMessage, begin, submitCode, cancel };
}
