import {
  computed,
  onScopeDispose,
  ref,
  shallowRef,
  toValue,
  type MaybeRefOrGetter,
} from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import type { ChatTurnEvent } from "@vynel/contracts/chat/chat-http";
import { useVynel } from "../use-vynel.js";
import { useUiStore } from "../../stores/ui-store.js";
import { useActivityStore } from "../../stores/activity-store.js";
import { readChatTurnEvents } from "../chat/chat-turn-stream.js";
import { sessionKeys } from "../chat/session-keys.js";
import {
  applyChatTurnEvent,
  createActiveTurnView,
} from "../chat/active-turn-view.js";
import type { ActiveTurnView } from "../chat/active-turn-view.js";

// Drives one user turn INTO a spawned session (`POST /sessions/:id/turn` —
// sessions-surface Slice ③). Same ChatTurnEvent frames as the chat turn, PLUS
// an optional leading `turn-queued` sentinel when the turn is parked behind a
// running delegated task (locked decision 3 — the composer says "queued", it
// never rejects). Events fold through the SAME live-turn view every chat
// surface renders (active-turn-view → ThreadStream/LiveTurn) — no third fold.
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

  /** The in-flight turn's renderable view — null when no turn is running
   *  (ThreadStream's activeTurn contract). */
  const view = shallowRef<ActiveTurnView | null>(null);
  /** Parked behind a running delegated task on this session — clears the
   *  moment the first real event arrives. */
  const isQueued = ref(false);
  const errorText = ref<string | null>(null);
  let abortController: AbortController | null = null;
  // View re-keys (tab/session switches) must not leave an orphaned reader
  // draining from a dead view (the use-chat-turn shape). Client abort only —
  // the server turn runs to completion and persists.
  let isDisposed = false;
  onScopeDispose(() => {
    isDisposed = true;
    abortController?.abort();
  });

  const isStreaming = computed(
    () => view.value !== null && view.value.status === "streaming",
  );

  async function startTurn(userMessageText: string): Promise<void> {
    if (view.value !== null) return;
    const id = toValue(sessionId);
    view.value = createActiveTurnView();
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
          // sends. Plain string since the roster went dynamic (the ui-store
          // restore shape-checks it; the engine is the real validator).
          model: ui.composerModelId,
          mode: ui.composerMode,
          thinkingEffort: ui.composerThinkingEffort,
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
        if (view.value !== null) {
          view.value = applyChatTurnEvent(view.value, event);
        }
        if (event.kind === "turn-stream-ended") break;
      }
      // The stream closed with NO terminal frame at all — a server crash
      // mid-turn used to end here looking exactly like success. A stream the
      // server ENDED deliberately (`turn-stream-ended`, hasEnded) is not a
      // drop, even when no completion event preceded it.
      if (
        view.value !== null &&
        view.value.status === "streaming" &&
        !view.value.hasEnded
      ) {
        errorText.value =
          "The connection to the assistant dropped mid-turn — anything already produced is in the transcript.";
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
      isQueued.value = false;
      activity.turnEnded();
      abortController = null;
    }

    // A disposed instance (view re-key mid-turn) stops here — no invalidation
    // from a dead view; the activity feed settles history at turn end.
    if (isDisposed) return;

    // Settle (the chat-turn order): the persisted rows land first, then the
    // overlay clears — nothing reflows to empty in between. `sessionKeys.all`
    // also refreshes the overview, so the library's percentages follow.
    // BOUNDED: a hung refetch must not strand the overlay (and the send queue
    // behind it) forever.
    await Promise.race([
      queryClient.invalidateQueries({ queryKey: sessionKeys.all }),
      new Promise((resolve) => setTimeout(resolve, 8000)),
    ]);
    view.value = null;
  }

  /** Client-side stop only — the session-turn surface has no interrupt route
   *  (v1); a stopped stream's turn runs to completion server-side and the
   *  settle refetch shows where it landed. */
  function interrupt(): void {
    abortController?.abort();
  }

  return { view, isStreaming, isQueued, errorText, startTurn, interrupt };
}
