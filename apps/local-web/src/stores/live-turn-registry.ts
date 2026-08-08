// The MULTIPLEXED live-turn registry (persona-sessions B3): ONE SSE + ONE
// `applyChatTurnEvent` fold per watched source, shared by every consumer via
// refcounted `subscribe()`. Hoists `use-watched-turn`'s proven per-session
// loop (seed + buffer + settle + auto re-attach + retry backoff) out of
// component scope so N surfaces watching one session cost one connection —
// and the activity monitor sheds its own one-attach-one-turn transport.
//
//   - 'session' sources RE-ATTACH across turns (the standing-watch contract):
//     turn ends → settle (refresh the snapshot provider, clear the overlay) →
//     subscribe again for the session's next turn.
//   - 'trace' sources are one-attach-per-job-run (a delegation's observe
//     stream ends with its turn); the consumer re-subscribes when its status
//     poll says the job went live again.
//
// Entries DIE at refCount 0 (abort + delete) — no LRU cap needed: consumers
// are few by design (the thread's standing watch, the monitor's top node, the
// B6 pane); the inline persona cards deliberately NEVER subscribe (they read
// the narration store).
//
// Suppression ("one turn never renders twice") moved to RENDER time: the
// registry always folds; a consumer whose OWN turn stream renders the same
// turn simply doesn't display the shared view (visible-active-turn precedent).

import { computed, shallowReactive, shallowRef, type ShallowRef } from "vue";
import { defineStore } from "pinia";
import type {
  ChatMessageResponse,
  ChatToolCallResponse,
  ChatTurnEvent,
} from "@vynel/contracts/chat/chat-http";
import { useQueryClient, type QueryClient } from "@tanstack/vue-query";
import { useVynel } from "../composables/use-vynel.js";
import { readChatTurnEvents } from "../composables/chat/chat-turn-stream.js";
import {
  applyChatTurnEvent,
  createActiveTurnView,
  type ActiveTurnView,
} from "../composables/chat/active-turn-view.js";
import {
  seedWatchedTurnView,
} from "../composables/chat/watched-turn-seed.js";
import {
  invalidateWorkViews,
  isWorkMutatingToolName,
} from "../composables/chat/work-view-invalidation.js";
import { useActivityStore } from "./activity-store.js";

export type LiveSource = { kind: "session" | "trace"; id: string };

/** The settled rows a seed/settle absorbs — the shape the detail reads return. */
export interface WatchedTurnSnapshot {
  messages: ChatMessageResponse[];
  toolCallsByMessageId: Record<string, ChatToolCallResponse[]>;
}

export interface LiveTurnSubscription {
  /** The shared fold — null while idle / after settle. */
  view: ShallowRef<ActiveTurnView | null>;
  /** True while the SSE is attached. */
  isAttached: ShallowRef<boolean>;
  /** A turn on this source ran to its end (trace sources stop here; session
   *  sources re-attach for the next turn). */
  hasEnded: ShallowRef<boolean>;
  /** A non-abort stream failure, said (the retry loop keeps going for
   *  session sources). */
  errorText: ShallowRef<string | null>;
  release: () => void;
}

const SEED_SETTLE_MS = 60;
const RETRY_BACKOFF_MS = 2000;

function sourceKey(source: LiveSource): string {
  return `${source.kind}:${source.id}`;
}

function isAbortError(candidate: unknown): boolean {
  return candidate instanceof Error && candidate.name === "AbortError";
}

interface RegistryEntry {
  refCount: number;
  view: ShallowRef<ActiveTurnView | null>;
  isAttached: ShallowRef<boolean>;
  hasEnded: ShallowRef<boolean>;
  errorText: ShallowRef<string | null>;
  /** The settled-rows provider (the FIRST subscriber offering one wins — the
   *  thread's own query stays the single fetcher); null = the registry's
   *  direct owner-gated read. Cleared when the PROVIDING subscription
   *  releases, so the fallback re-engages for surviving consumers (a dead
   *  provider must never starve the entry's seeds). */
  fetchSnapshot: (() => Promise<WatchedTurnSnapshot | undefined>) | null;
  /** Which subscription supplied `fetchSnapshot` — the release that clears it. */
  fetchSnapshotOwner: symbol | null;
  abortController: AbortController | null;
  disposed: boolean;
}

export const useLiveTurnRegistry = defineStore("live-turn-registry", () => {
  const vynel = useVynel();
  const activity = useActivityStore();
  const queryClient: QueryClient = useQueryClient();
  const entries = shallowReactive(new Map<string, RegistryEntry>());

  function turnStartedAtMsFor(sessionId: string): number | null {
    const turn = activity.serverTurnForSession(sessionId);
    const parsed = turn === null ? Number.NaN : Date.parse(turn.startedAt);
    return Number.isNaN(parsed) ? null : parsed;
  }

  async function defaultSnapshot(
    sessionId: string,
  ): Promise<WatchedTurnSnapshot | undefined> {
    try {
      const detail = await vynel.root.getSession(sessionId);
      return {
        messages: detail.messages,
        toolCallsByMessageId: detail.toolCallsByMessageId,
      };
    } catch {
      // A failed seed fetch aborts THIS seed only — the next stream event
      // retries it (the watched-turn loop's standing recovery).
      return undefined;
    }
  }

  async function runSession(entry: RegistryEntry, sessionId: string) {
    const isCurrent = (): boolean => !entry.disposed;
    while (isCurrent()) {
      const controller = new AbortController();
      entry.abortController = controller;
      let sawTurnEnd = false;
      try {
        const { data, response } = await vynel.GET("/sessions/{sessionId}/stream", {
          params: { path: { sessionId } },
          parseAs: "stream",
          signal: controller.signal,
        });
        if (!response.ok || !data)
          throw new Error(`session stream refused (${response.status})`);
        entry.isAttached.value = true;
        entry.errorText.value = null;

        let buffered: ChatTurnEvent[] = [];
        let isSeeding = false;
        let isSeeded = false;
        let isStreamLive = true;

        const seedFromSnapshot = async (): Promise<void> => {
          try {
            const snapshot = await (entry.fetchSnapshot?.() ??
              defaultSnapshot(sessionId));
            await new Promise((resolve) => setTimeout(resolve, SEED_SETTLE_MS));
            if (
              !isCurrent() ||
              !isStreamLive ||
              snapshot === undefined ||
              buffered.length === 0
            ) {
              isSeeding = false;
              return;
            }
            entry.view.value = seedWatchedTurnView({
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
            if (event.kind === "turn-stream-ended") {
              sawTurnEnd = true;
              break;
            }
            // A watched turn still writes the task list + step dock — refresh
            // them from the ONE fold site (the own-stream rule).
            if (
              event.kind === "tool-call-completed" &&
              isWorkMutatingToolName(event.toolCall.toolName)
            ) {
              void invalidateWorkViews(queryClient);
            }
            if (isSeeded) {
              entry.view.value = applyChatTurnEvent(
                entry.view.value ?? createActiveTurnView(),
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
        entry.errorText.value =
          streamError instanceof Error
            ? streamError.message
            : "The live view dropped.";
      }
      entry.isAttached.value = false;
      if (!isCurrent()) return;
      if (sawTurnEnd) {
        entry.hasEnded.value = true;
        // Settle in the chat-turn order: rows land first, then the overlay
        // clears — then re-subscribe for the session's next turn (the
        // standing-watch contract; fixes the monitor's one-attach-one-turn).
        try {
          await (entry.fetchSnapshot?.() ?? defaultSnapshot(sessionId));
        } catch {
          // The activity feed's turn-ended invalidation covers a failed settle.
        }
        if (!isCurrent()) return;
        entry.view.value = null;
        entry.hasEnded.value = false;
        continue;
      }
      // Dropped without a turn end (server restart, refused) — clear any
      // stale overlay and come back.
      entry.view.value = null;
      await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS));
    }
  }

  async function runTrace(entry: RegistryEntry, traceId: string) {
    const isCurrent = (): boolean => !entry.disposed;
    const controller = new AbortController();
    entry.abortController = controller;
    try {
      const { data, response } = await vynel.GET(
        "/root/trace/{partialSessionId}/stream",
        {
          params: { path: { partialSessionId: traceId } },
          parseAs: "stream",
          signal: controller.signal,
        },
      );
      if (!response.ok || !data)
        throw new Error(`trace stream refused (${response.status})`);
      entry.isAttached.value = true;
      entry.errorText.value = null;
      for await (const event of readChatTurnEvents(data)) {
        if (!isCurrent()) return;
        if (event.kind === "turn-stream-ended") break;
        if (
          event.kind === "tool-call-completed" &&
          isWorkMutatingToolName(event.toolCall.toolName)
        ) {
          void invalidateWorkViews(queryClient);
        }
        entry.view.value = applyChatTurnEvent(
          entry.view.value ?? createActiveTurnView(),
          event,
        );
      }
      if (isCurrent()) entry.hasEnded.value = true;
    } catch (streamError) {
      if (isCurrent() && !isAbortError(streamError)) {
        entry.errorText.value =
          streamError instanceof Error
            ? streamError.message
            : "The live view dropped.";
      }
    } finally {
      if (isCurrent()) entry.isAttached.value = false;
    }
  }

  function subscribe(
    source: LiveSource,
    options: {
      /** Settled-rows provider for session seeds/settles — the first
       *  subscriber offering one wins for the entry's lifetime. */
      fetchSnapshot?: () => Promise<WatchedTurnSnapshot | undefined>;
    } = {},
  ): LiveTurnSubscription {
    const key = sourceKey(source);
    let entry = entries.get(key);
    if (entry === undefined) {
      entry = {
        refCount: 0,
        view: shallowRef(null),
        isAttached: shallowRef(false),
        hasEnded: shallowRef(false),
        errorText: shallowRef(null),
        fetchSnapshot: null,
        fetchSnapshotOwner: null,
        abortController: null,
        disposed: false,
      };
      entries.set(key, entry);
      if (source.kind === "session") {
        void runSession(entry, source.id);
      } else {
        void runTrace(entry, source.id);
      }
    }
    const subscriberId = Symbol("live-turn-subscriber");
    if (entry.fetchSnapshot === null && options.fetchSnapshot !== undefined) {
      entry.fetchSnapshot = options.fetchSnapshot;
      entry.fetchSnapshotOwner = subscriberId;
    }
    entry.refCount += 1;

    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      const current = entries.get(key);
      if (current !== entry) return;
      // The providing subscription is leaving — re-engage the fallback for
      // survivors (its closure would otherwise fetch a re-targeted or dead
      // query for the rest of the entry's life).
      if (entry.fetchSnapshotOwner === subscriberId) {
        entry.fetchSnapshot = null;
        entry.fetchSnapshotOwner = null;
      }
      entry.refCount -= 1;
      if (entry.refCount > 0) return;
      entry.disposed = true;
      entry.abortController?.abort();
      entries.delete(key);
    };
    return {
      view: entry.view,
      isAttached: entry.isAttached,
      hasEnded: entry.hasEnded,
      errorText: entry.errorText,
      release,
    };
  }

  /** Test/diagnostic surface — how many live entries exist right now. */
  const activeCount = computed(() => entries.size);

  return { subscribe, activeCount };
});
