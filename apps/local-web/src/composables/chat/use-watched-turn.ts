// The thread's STANDING subscription to its displayed session's live channel
// (`GET /sessions/:id/stream`) — the missing half of the tab-switch lifecycle.
// Switching away aborts the origin view's own turn stream by design (the
// server turn keeps running, rows persist per chunk); without this, the
// returning view only had a 4s history poll — no overlay, no thinking, no
// status line ("responses slow, indicators gone", Chad 2026-07-31). The
// watcher folds any turn on the displayed session — a reattached own turn, a
// schedule fire, a channel turn — into the SAME ActiveTurnView the origin
// stream renders, so a re-entered room is indistinguishable from one you
// never left. An idle attach costs one SSE with 25s heartbeats.

import { onScopeDispose, shallowRef, watch } from "vue";
import type {
  ChatMessageResponse,
  ChatToolCallResponse,
  ChatTurnEvent,
} from "@vynel/contracts/chat/chat-http";
import { useVynel } from "../use-vynel.js";
import { useActivityStore } from "../../stores/activity-store.js";
import { readChatTurnEvents } from "./chat-turn-stream.js";
import {
  applyChatTurnEvent,
  createActiveTurnView,
  type ActiveTurnView,
} from "./active-turn-view.js";
import { seedWatchedTurnView } from "./watched-turn-seed.js";

export interface WatchedTurnSnapshot {
  messages: ChatMessageResponse[];
  toolCallsByMessageId: Record<string, ChatToolCallResponse[]>;
}

// Frames in transit when the seed snapshot resolves land within this grace,
// so the overlap-dedupe sees them in the buffer instead of appending them
// blind after the seed (the API is local; frames are in-order on one socket).
const SEED_SETTLE_MS = 60;
// A dropped/refused stream retries on this backoff — the channel is the core
// liveness surface, so it must come back without a reload.
const RETRY_BACKOFF_MS = 2000;

function isAbortError(candidate: unknown): boolean {
  return candidate instanceof Error && candidate.name === "AbortError";
}

export function useWatchedTurn(options: {
  /** The session the thread displays — null detaches the watcher. The ONLY
   *  callback read synchronously (setup-time); the others fire async-only, so
   *  callers may close over consts declared after this composable call. */
  sessionId: () => string | null;
  /** True while the view's OWN turn overlay renders this thread — the watcher
   *  stays subscribed but quiet (one turn must never render twice). */
  isSuppressed: () => boolean;
  /** Fresh settled rows — the mid-turn seed and the turn-end settle. MUST
   *  reject on a failed fetch (TanStack's refetch resolves with `error`
   *  instead of throwing — the caller surfaces it). */
  refetchDetail: () => Promise<WatchedTurnSnapshot | undefined>;
}) {
  const vynel = useVynel();
  const activity = useActivityStore();
  const view = shallowRef<ActiveTurnView | null>(null);

  let disposed = false;
  let epoch = 0;
  let abortController: AbortController | null = null;

  // The turn's TRUE start when the activity feed saw it begin — the seed's
  // absorb boundary AND the elapsed clock (without it a reattached overlay's
  // clock would restart from the switch-back). Null when the feed doesn't know.
  function turnStartedAtMsFor(sessionId: string): number | null {
    const turn = activity.serverTurnForSession(sessionId);
    const parsed = turn === null ? Number.NaN : Date.parse(turn.startedAt);
    return Number.isNaN(parsed) ? null : parsed;
  }

  async function watchSession(sessionId: string, myEpoch: number): Promise<void> {
    const isCurrent = (): boolean => !disposed && myEpoch === epoch;
    while (isCurrent()) {
      const controller = new AbortController();
      abortController = controller;
      let sawTurnEnd = false;
      try {
        const { data, response } = await vynel.GET("/sessions/{sessionId}/stream", {
          params: { path: { sessionId } },
          parseAs: "stream",
          signal: controller.signal,
        });
        if (!response.ok || !data)
          throw new Error(`session stream refused (${response.status})`);

        let buffered: ChatTurnEvent[] = [];
        let isSeeding = false;
        let isSeeded = false;
        // Guards the async seed against its turn dying under it: a seed that
        // resolves after turn-stream-ended (or a drop) must NOT resurrect a
        // "streaming" overlay for a finished turn — the settle already ran and
        // nothing would ever clear it again.
        let isStreamLive = true;

        const seedFromSnapshot = async (): Promise<void> => {
          try {
            const snapshot = await options.refetchDetail();
            await new Promise((resolve) => setTimeout(resolve, SEED_SETTLE_MS));
            if (
              !isCurrent() ||
              !isStreamLive ||
              options.isSuppressed() ||
              snapshot === undefined ||
              buffered.length === 0
            ) {
              isSeeding = false;
              return;
            }
            view.value = seedWatchedTurnView({
              messages: snapshot.messages,
              toolCallsByMessageId: snapshot.toolCallsByMessageId,
              bufferedEvents: buffered.splice(0),
              startedAtMs: turnStartedAtMsFor(sessionId) ?? Date.now(),
              turnStartedAtMs: turnStartedAtMsFor(sessionId),
            });
            isSeeded = true;
          } catch {
            isSeeding = false; // the next event retries the seed
          }
        };

        try {
          for await (const event of readChatTurnEvents(data)) {
            if (!isCurrent()) return;
            if (options.isSuppressed()) {
              // The own stream renders this turn — discard its echo here.
              view.value = null;
              buffered = [];
              isSeeded = false;
              if (event.kind === "turn-stream-ended") {
                sawTurnEnd = true;
                break;
              }
              continue;
            }
            if (event.kind === "turn-stream-ended") {
              sawTurnEnd = true;
              break;
            }
            if (isSeeded) {
              view.value = applyChatTurnEvent(
                view.value ?? createActiveTurnView(),
                event,
              );
              continue;
            }
            buffered.push(event);
            if (!isSeeding) {
              isSeeding = true;
              void seedFromSnapshot();
            }
          }
        } finally {
          isStreamLive = false;
        }
      } catch (streamError) {
        if (!isCurrent() || isAbortError(streamError)) return;
      }
      if (!isCurrent()) return;
      if (sawTurnEnd) {
        // Settle in the chat-turn order: rows land first, then the overlay
        // clears — then re-subscribe for the session's next turn.
        try {
          await options.refetchDetail();
        } catch {
          // The activity feed's turn-ended invalidation covers a failed settle.
        }
        if (!isCurrent()) return;
        view.value = null;
        continue;
      }
      // Dropped without a turn end (server restart, refused) — clear any
      // stale overlay and come back.
      view.value = null;
      await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS));
    }
  }

  watch(
    () => options.sessionId(),
    (sessionId) => {
      epoch += 1;
      abortController?.abort();
      abortController = null;
      view.value = null;
      if (sessionId !== null) void watchSession(sessionId, epoch);
    },
    { immediate: true },
  );
  onScopeDispose(() => {
    disposed = true;
    abortController?.abort();
  });

  return { view };
}
