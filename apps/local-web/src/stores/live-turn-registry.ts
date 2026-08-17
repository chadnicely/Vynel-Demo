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
//
// THE ATTACH GATE (the socket diet, 2026-08-18): a session watch holds an SSE
// socket ONLY while the activity feed reports a turn on that session AND at
// least one subscriber would actually render it. Browsers cap HTTP/1.1 at six
// connections per origin, shared by every tab: standing idle watches (one per
// displayed thread, per tab) plus the app's own feed/voice streams and a
// running turn's stream were enough to queue every other request — the
// "frozen tab". The server's contract already reads "an idle attach waits
// silently … the activity feed drives the UI's attach lifecycle"; the client
// now honors it: attach on the feed's turn-started, settle at turn end, and
// detach instead of idling until the feed says the next turn is on. Nothing
// is missed by attaching late — rows persist per chunk and the mid-turn seed
// absorbs them; the feed's own replay covers a reconnect.

import {
  computed,
  shallowReactive,
  shallowRef,
  watch,
  type ShallowRef,
} from "vue";
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
  /** Each subscriber's "I would render this" getter — the attach gate needs at
   *  least one consumer that isn't suppressed by its own turn overlay. */
  subscribers: Map<symbol, { isSuppressed: () => boolean }>;
  /** The connect loop is alive (attached, seeding, or between turns). */
  isRunning: boolean;
  /** Folding a turn right now — a gate close never cuts a turn mid-way; the
   *  loop settles it first and only then stops. */
  isMidTurn: boolean;
  /** Stops the gate watcher at disposal. */
  stopGate: (() => void) | null;
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

  /** The attach gate: a live turn on the session (per the feed) and someone
   *  who would render it. Reactive — read inside the entry's gate watcher. */
  function wantsSessionAttach(entry: RegistryEntry, sessionId: string): boolean {
    if (activity.serverTurnForSession(sessionId) === null) return false;
    for (const subscriber of entry.subscribers.values()) {
      if (!subscriber.isSuppressed()) return true;
    }
    return false;
  }

  /** The gate flipped: start the loop when a turn is on and nobody is
   *  attached; cut an IDLE attach when it goes off (a mid-turn attach settles
   *  first — the loop re-checks the gate before re-attaching). */
  function reconcileSessionAttach(entry: RegistryEntry, sessionId: string, wants: boolean): void {
    if (entry.disposed) return;
    if (wants) {
      if (!entry.isRunning) void runSession(entry, sessionId);
      return;
    }
    if (entry.isRunning && !entry.isMidTurn) entry.abortController?.abort();
  }

  async function runSession(entry: RegistryEntry, sessionId: string) {
    const isCurrent = (): boolean => !entry.disposed;
    entry.isRunning = true;
    try {
      await runSessionLoop(entry, sessionId, isCurrent);
    } finally {
      entry.isRunning = false;
      entry.isMidTurn = false;
      entry.abortController = null;
      if (isCurrent()) entry.isAttached.value = false;
    }
    // The gate may have re-opened while this loop was winding down (a feed
    // flap: off, then on again before the abort settled) — the watcher saw
    // isRunning still true and did nothing, so re-check here.
    if (isCurrent() && wantsSessionAttach(entry, sessionId)) void runSession(entry, sessionId);
  }

  async function runSessionLoop(
    entry: RegistryEntry,
    sessionId: string,
    isCurrent: () => boolean,
  ) {
    // The gate is re-read at every attach: after a settle the loop only comes
    // back for the session's next turn when the feed says one is on.
    while (isCurrent() && wantsSessionAttach(entry, sessionId)) {
      const controller = new AbortController();
      entry.abortController = controller;
      entry.isMidTurn = false;
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

        const buffered: ChatTurnEvent[] = [];
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
            entry.isMidTurn = true;
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
        // Disposal or a gate-close abort of an idle attach — the loop ends;
        // the gate watcher restarts it when a turn is on again.
        if (!isCurrent() || isAbortError(streamError)) return;
        entry.errorText.value =
          streamError instanceof Error
            ? streamError.message
            : "The live view dropped.";
      }
      entry.isAttached.value = false;
      entry.isMidTurn = false;
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
      /** True while this consumer's OWN turn overlay renders the source (it
       *  shows nothing from the fold) — a session watch nobody would render
       *  holds no socket. Omit = always renders. */
      isSuppressed?: () => boolean;
    } = {},
  ): LiveTurnSubscription {
    const key = sourceKey(source);
    let entry = entries.get(key);
    const subscriberId = Symbol("live-turn-subscriber");
    if (entry === undefined) {
      const created: RegistryEntry = {
        refCount: 0,
        view: shallowRef(null),
        isAttached: shallowRef(false),
        hasEnded: shallowRef(false),
        errorText: shallowRef(null),
        fetchSnapshot: null,
        fetchSnapshotOwner: null,
        abortController: null,
        disposed: false,
        subscribers: shallowReactive(new Map()),
        isRunning: false,
        isMidTurn: false,
        stopGate: null,
      };
      entry = created;
      entries.set(key, entry);
      if (source.kind === "trace") {
        // A trace observe is one-attach-per-job-run — the consumer subscribes
        // when its poll says the job is live, so attach at once.
        void runTrace(entry, source.id);
      }
    }
    if (entry.fetchSnapshot === null && options.fetchSnapshot !== undefined) {
      entry.fetchSnapshot = options.fetchSnapshot;
      entry.fetchSnapshotOwner = subscriberId;
    }
    entry.refCount += 1;
    entry.subscribers.set(subscriberId, {
      isSuppressed: options.isSuppressed ?? (() => false),
    });
    if (source.kind === "session" && entry.stopGate === null) {
      const gated = entry;
      const sessionId = source.id;
      // Installed after the first subscriber is registered so the immediate
      // run sees it; suppression getters read reactive state, so the watcher
      // re-evaluates as own overlays come and go.
      gated.stopGate = watch(
        () => wantsSessionAttach(gated, sessionId),
        (wants) => reconcileSessionAttach(gated, sessionId, wants),
        { immediate: true },
      );
    }

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
      entry.subscribers.delete(subscriberId);
      entry.refCount -= 1;
      if (entry.refCount > 0) return;
      entry.disposed = true;
      entry.stopGate?.();
      entry.stopGate = null;
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
  /** How many entries hold a socket right now (the diet's measure). */
  const attachedCount = computed(
    () => [...entries.values()].filter((entry) => entry.isAttached.value).length,
  );

  return { subscribe, activeCount, attachedCount };
});
