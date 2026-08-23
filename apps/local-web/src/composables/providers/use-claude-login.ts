import { ref } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { SdkError } from "@vynel/sdk";
import { useVynel } from "../use-vynel.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import { claudeAuthKeys } from "./use-claude-auth-status.js";

// The sign-in flow's client half (top-bar account popup): begin opens the
// relay — the engine's own CLI opens the browser and finishes by itself once
// the browser's callback lands — and this side polls until it settles (the
// GitHub sign-in door's shape). The fallback link + pasted code exist for a
// browser that didn't open, or a private window holding a different account.
// The credential never passes through here — the CLI writes its own file.
export type ClaudeLoginViewPhase =
  | "idle"
  | "opening"
  | "browser"
  | "finishing"
  | "error";

const POLL_MS = 1_500;
const SIGN_IN_GONE = "That sign-in is no longer open — start again.";

function isNotFound(error: unknown): boolean {
  return error instanceof SdkError && error.status === 404;
}

export function useClaudeLogin() {
  const vynel = useVynel();
  const queryClient = useQueryClient();

  const phase = ref<ClaudeLoginViewPhase>("idle");
  const authorizationUrl = ref<string | null>(null);
  const errorMessage = ref<string | null>(null);
  let loginId: string | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  // Bumped by cancel — a begin still in flight when the dialog closes must
  // not resurrect the flow when its answer lands.
  let attempt = 0;

  async function begin(): Promise<void> {
    const thisAttempt = ++attempt;
    phase.value = "opening";
    errorMessage.value = null;
    let opened: Awaited<ReturnType<typeof vynel.providers.beginLogin>>;
    try {
      opened = await vynel.providers.beginLogin("claude");
    } catch (error) {
      if (thisAttempt === attempt) fail(formatSdkError(error));
      return;
    }
    if (thisAttempt !== attempt) {
      void vynel.providers.cancelLogin("claude", opened.loginId).catch(() => undefined);
      return;
    }
    loginId = opened.loginId;
    authorizationUrl.value = opened.authorizationUrl;
    if (opened.phase === "signed-in") {
      await settle();
      return;
    }
    phase.value = "browser";
    pollTimer = setTimeout(() => void poll(opened.loginId), POLL_MS);
  }

  // One read per tick until the CLI's verdict; stops quietly when cancel
  // (or a newer begin) moved on.
  async function poll(id: string): Promise<void> {
    let state: Awaited<ReturnType<typeof vynel.providers.getLogin>>;
    try {
      state = await vynel.providers.getLogin("claude", id);
    } catch (error) {
      // 404 = the relay released it (abandoned too long, or the engine
      // restarted) — say that, not the raw error id.
      if (loginId === id) fail(isNotFound(error) ? SIGN_IN_GONE : formatSdkError(error));
      return;
    }
    if (loginId !== id) return;
    if (state.phase === "signed-in") {
      await settle();
      return;
    }
    if (state.phase === "failed") {
      fail(state.errorMessage ?? "The sign-in did not finish. Try again.");
      return;
    }
    pollTimer = setTimeout(() => void poll(id), POLL_MS);
  }

  /** The fallback: hand over the code the browser showed; the poll settles
   *  the verdict. */
  async function submitCode(code: string): Promise<void> {
    const id = loginId;
    if (id === null || code.trim().length === 0) return;
    try {
      const state = await vynel.providers.submitLoginCode("claude", id, { code: code.trim() });
      if (loginId === id && state.phase === "finishing") phase.value = "finishing";
    } catch (error) {
      // A 404 only means the session already moved on (the browser's
      // callback settled it first) — the poll carries the real verdict.
      if (loginId === id && !isNotFound(error)) fail(formatSdkError(error));
    }
  }

  // Hold the spinner through the status refetch — flashing the signed-out
  // button mid-refresh invites a second, pointless sign-in.
  async function settle(): Promise<void> {
    stopPolling();
    loginId = null;
    authorizationUrl.value = null;
    phase.value = "finishing";
    await queryClient.invalidateQueries({ queryKey: claudeAuthKeys.status });
    phase.value = "idle";
  }

  function fail(reason: string): void {
    stopPolling();
    loginId = null;
    errorMessage.value = reason;
    phase.value = "error";
  }

  function cancel(): void {
    attempt += 1;
    stopPolling();
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

  function stopPolling(): void {
    if (pollTimer !== null) clearTimeout(pollTimer);
    pollTimer = null;
  }

  return { phase, authorizationUrl, errorMessage, begin, submitCode, cancel };
}
