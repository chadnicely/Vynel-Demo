import { ref, toValue, type MaybeRefOrGetter } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import type { ChatTurnEvent } from "@vynel/contracts/chat/chat-http";
import type { ChatModelId } from "@vynel/contracts/chat/chat-models";
import { useVynel } from "../use-vynel.js";
import { useUiStore } from "../../stores/ui-store.js";
import { useActivityStore } from "../../stores/activity-store.js";
import { readChatTurnEvents } from "../chat/chat-turn-stream.js";
import { sessionKeys } from "../chat/session-keys.js";
import {
  applyTraceStreamEvent,
  createLiveTraceState,
} from "../delegations/fold-trace-stream.js";

// Drives one user turn INTO a spawned session (`POST /sessions/:id/turn` —
// sessions-surface Slice ③). Same ChatTurnEvent frames as the chat turn, PLUS
// an optional leading `turn-queued` sentinel when the turn is parked behind a
// running delegated task (locked decision 3 — the composer says "queued", it
// never rejects). Events fold through the monitor's own trace fold (no third
// fold): the thread merges this overlay over `useActivityMonitor`'s entries,
// which dedupe by id when the monitor's session channel carries the same turn.
//
// The sentinel is not a ChatTurnEvent kind — widen the decoded stream at the
// transport boundary, exactly like the server's `turn-stream-ended` precedent.
type SessionTurnStreamEvent = ChatTurnEvent | { kind: "turn-queued" };

function isAbortError(candidate: unknown): boolean {
  return candidate instanceof Error && candidate.name === "AbortError";
}

export function useSessionTurn(sessionId: MaybeRefOrGetter<string>) {
  const vynel = useVynel();
  const ui = useUiStore();
  const queryClient = useQueryClient();
  const activity = useActivityStore();

  const state = ref(createLiveTraceState());
  const isStreaming = ref(false);
  /** Parked behind a running delegated task on this session — clears the
   *  moment the first real event arrives. */
  const isQueued = ref(false);
  const errorText = ref<string | null>(null);
  let abortController: AbortController | null = null;

  async function startTurn(userMessageText: string): Promise<void> {
    if (isStreaming.value) return;
    const id = toValue(sessionId);
    state.value = createLiveTraceState();
    isStreaming.value = true;
    isQueued.value = false;
    errorText.value = null;
    activity.turnStarted();
    abortController = new AbortController();

    try {
      const { data, response } = await vynel.POST("/sessions/{sessionId}/turn", {
        params: { path: { sessionId: id } },
        body: {
          userMessageText,
          // The shared composer selections — the same trio every chat turn
          // sends (the ui-store restores fail-closed, so the cast is honest).
          model: ui.composerModelId as ChatModelId,
          mode: ui.composerMode,
          ...(ui.composerThinkingEffort !== "auto"
            ? { thinkingEffort: ui.composerThinkingEffort }
            : {}),
        },
        parseAs: "stream",
        signal: abortController.signal,
      });
      if (!response.ok || !data) {
        // The route 404s a stale handle (the session was deleted, or the view
        // outlived a chain swap) — say where to go, not a status code.
        throw new Error(
          response.status === 404
            ? "This session has moved — go back and reopen it."
            : `The session turn failed (${response.status}).`,
        );
      }
      const events = readChatTurnEvents(
        data,
      ) as AsyncGenerator<SessionTurnStreamEvent>;
      for await (const event of events) {
        if (event.kind === "turn-queued") {
          isQueued.value = true;
          continue;
        }
        isQueued.value = false;
        if (event.kind === "turn-stream-ended") break;
        state.value = applyTraceStreamEvent(state.value, event);
      }
    } catch (turnError) {
      // An abort is the user's own stop; a real drop must be SAID. Either way
      // the turn may finish server-side — the settle refetch below reconciles.
      if (!isAbortError(turnError)) {
        errorText.value =
          turnError instanceof Error
            ? turnError.message
            : "The turn stream dropped — the reply lands in the transcript.";
      }
    } finally {
      isStreaming.value = false;
      isQueued.value = false;
      activity.turnEnded();
      abortController = null;
    }

    // Settle (the monitor's order): the persisted rows land first, then the
    // overlay clears — nothing reflows to empty in between. `sessionKeys.all`
    // also refreshes the overview, so the library's meters follow the turn.
    await queryClient.invalidateQueries({ queryKey: sessionKeys.all });
    state.value = createLiveTraceState();
  }

  /** Client-side stop only — the session-turn surface has no interrupt route
   *  (v1); a stopped stream's turn runs to completion server-side and the
   *  settle refetch shows where it landed. */
  function interrupt(): void {
    abortController?.abort();
  }

  return { state, isStreaming, isQueued, errorText, startTurn, interrupt };
}
