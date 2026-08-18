// The MULTIPLEXED live-turn registry (persona-sessions B3): ONE channel
// subscription + ONE `applyChatTurnEvent` fold per watched source, shared by
// every consumer via refcounted `subscribe()`, so N surfaces watching one
// session cost one subscription on the window's one live socket
// (`live-channel-store`). Entries DIE at refCount 0 — no LRU cap needed:
// consumers are few by design (the thread's standing watch, the sidebar's
// pane); the inline persona cards deliberately NEVER subscribe.
//
//   - 'session' sources are STANDING: a turn's end (`channel-ended`) settles
//     the entry (refresh the snapshot provider, clear the overlay) and the
//     same subscription simply receives the session's next turn.
//   - 'trace' sources end with their job run (`hasEnded` stays true; the
//     consumer re-subscribes when its status poll says the job went live).
//
// SHOW IMMEDIATELY: opening a thread whose turn is already running must not
// wait for the turn's next chunk — on the channel ack, when the activity feed
// says a turn is on the session, the entry seeds the overlay from the
// persisted rows at once (rows persist per chunk, so "the turn so far" is in
// the DB); events that arrive during the seed fold on top, overlap-deduped
// (watched-turn-seed). A socket drop re-seeds on the re-ack the same way.
//
// Suppression ("one turn never renders twice") lives at RENDER time in the
// adapter: the registry always folds; a consumer whose OWN turn stream renders
// the same turn simply doesn't display the shared view.

import { computed, shallowReactive, shallowRef, type ShallowRef } from "vue";
import { defineStore } from "pinia";
import type {
  ChatMessageResponse,
  ChatToolCallResponse,
  ChatTurnEvent,
} from "@vynel/contracts/chat/chat-http";
import { liveChannelKeys } from "@vynel/contracts/chat/live-channel";
import { useQueryClient, type QueryClient } from "@tanstack/vue-query";
import { useVynel } from "../composables/use-vynel.js";
import {
  applyChatTurnEvent,
  createActiveTurnView,
  type ActiveTurnView,
} from "../composables/chat/active-turn-view.js";
import { seedWatchedTurnView } from "../composables/chat/watched-turn-seed.js";
import {
  invalidateWorkViews,
  isWorkMutatingToolName,
} from "../composables/chat/work-view-invalidation.js";
import { useActivityStore } from "./activity-store.js";
import { useLiveChannelStore } from "./live-channel-store.js";

export type LiveSource = { kind: "session" | "trace"; id: string };

/** The settled rows a seed/settle absorbs — the shape the detail reads return. */
export interface WatchedTurnSnapshot {
  messages: ChatMessageResponse[];
  toolCallsByMessageId: Record<string, ChatToolCallResponse[]>;
}

export interface LiveTurnSubscription {
  /** The shared fold — null while idle / after settle. */
  view: ShallowRef<ActiveTurnView | null>;
  /** True while the channel is acked on the live socket. */
  isAttached: ShallowRef<boolean>;
  /** A turn on this source ran to its end (trace sources stop here; session
   *  sources clear it again once the settle lands). */
  hasEnded: ShallowRef<boolean>;
  /** The channel was refused or dropped mid-turn, said. */
  errorText: ShallowRef<string | null>;
  release: () => void;
}

const SEED_SETTLE_MS = 60;

function sourceKey(source: LiveSource): string {
  return `${source.kind}:${source.id}`;
}

interface RegistryEntry {
  source: LiveSource;
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
  releaseChannel: (() => void) | null;
  disposed: boolean;
  /** Events received before the seed landed — folded on top of it. */
  buffered: ChatTurnEvent[];
  isSeeding: boolean;
  isSeeded: boolean;
  /** Bumped by anything that invalidates an in-flight seed (turn end,
   *  detach, disposal) — a stale seed must never resurrect an overlay. */
  seedGeneration: number;
  /** Bumped per turn end — a settle that lands after the next turn's seed
   *  must not wipe that seed's overlay. */
  turnGeneration: number;
}

export const useLiveTurnRegistry = defineStore("live-turn-registry", () => {
  const vynel = useVynel();
  const activity = useActivityStore();
  const live = useLiveChannelStore();
  const queryClient: QueryClient = useQueryClient();
  const entries = shallowReactive(new Map<string, RegistryEntry>());

  function turnStartedAtMsFor(entry: RegistryEntry): number | null {
    if (entry.source.kind !== "session") return null;
    const turn = activity.serverTurnForSession(entry.source.id);
    const parsed = turn === null ? Number.NaN : Date.parse(turn.startedAt);
    return Number.isNaN(parsed) ? null : parsed;
  }

  function hasLiveTurn(entry: RegistryEntry): boolean {
    return (
      entry.source.kind === "session" &&
      activity.serverTurnForSession(entry.source.id) !== null
    );
  }

  async function defaultSnapshot(
    entry: RegistryEntry,
  ): Promise<WatchedTurnSnapshot | undefined> {
    if (entry.source.kind !== "session") return undefined;
    try {
      const detail = await vynel.root.getSession(entry.source.id);
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

  function readSnapshot(entry: RegistryEntry): Promise<WatchedTurnSnapshot | undefined> {
    return entry.fetchSnapshot?.() ?? defaultSnapshot(entry);
  }

  /** Rebuild "the turn so far" from the persisted rows and fold whatever
   *  streamed meanwhile on top. Runs on the first event of an unseeded turn
   *  AND, for a session the feed reports live, right at the channel ack. */
  function beginSeed(entry: RegistryEntry): void {
    if (entry.isSeeding || entry.isSeeded) return;
    entry.isSeeding = true;
    const generation = entry.seedGeneration;
    void (async () => {
      let snapshot: WatchedTurnSnapshot | undefined;
      try {
        snapshot = await readSnapshot(entry);
      } catch {
        snapshot = undefined;
      }
      await new Promise((resolve) => setTimeout(resolve, SEED_SETTLE_MS));
      if (entry.disposed || generation !== entry.seedGeneration) {
        entry.isSeeding = false;
        return;
      }
      if (snapshot === undefined) {
        entry.isSeeding = false; // the next event retries the seed
        return;
      }
      const turnStartedAtMs = turnStartedAtMsFor(entry);
      entry.view.value = seedWatchedTurnView({
        messages: snapshot.messages,
        toolCallsByMessageId: snapshot.toolCallsByMessageId,
        bufferedEvents: entry.buffered.splice(0),
        startedAtMs: turnStartedAtMs ?? Date.now(),
        turnStartedAtMs,
      });
      entry.isSeeded = true;
      entry.isSeeding = false;
    })();
  }

  function onEvent(entry: RegistryEntry, event: ChatTurnEvent): void {
    if (entry.disposed) return;
    // A watched turn still writes the task list + step dock — refresh them
    // from the ONE fold site (the own-stream rule).
    if (
      event.kind === "tool-call-completed" &&
      isWorkMutatingToolName(event.toolCall.toolName)
    ) {
      void invalidateWorkViews(queryClient);
    }
    if (entry.isSeeded) {
      entry.view.value = applyChatTurnEvent(
        entry.view.value ?? createActiveTurnView(),
        event,
      );
      return;
    }
    if (entry.source.kind === "trace") {
      // A trace attaches at job start (the consumer subscribes when its poll
      // says live) — fold from the first frame, no rows to absorb.
      entry.isSeeded = true;
      entry.view.value = applyChatTurnEvent(createActiveTurnView(), event);
      return;
    }
    entry.buffered.push(event);
    beginSeed(entry);
  }

  /** The turn ended on the wire — settle in the chat-turn order: rows land
   *  first, then the overlay clears. A session subscription stays for the
   *  next turn (its events may already be arriving — the generation guards
   *  keep a late settle from wiping the next turn's seed). */
  function onEnded(entry: RegistryEntry): void {
    if (entry.disposed) return;
    entry.hasEnded.value = true;
    entry.seedGeneration += 1;
    entry.isSeeding = false;
    entry.isSeeded = false;
    entry.buffered = [];
    const settled = ++entry.turnGeneration;
    void (async () => {
      try {
        await readSnapshot(entry);
      } catch {
        // The activity feed's turn-ended invalidation covers a failed settle.
      }
      if (entry.disposed || entry.turnGeneration !== settled) return;
      if (!entry.isSeeded) entry.view.value = null;
      if (entry.source.kind === "session") entry.hasEnded.value = false;
    })();
  }

  function onSubscribed(entry: RegistryEntry): void {
    if (entry.disposed) return;
    entry.isAttached.value = true;
    entry.errorText.value = null;
    if (hasLiveTurn(entry)) {
      // Show immediately: the turn is on — seed from the rows now instead of
      // waiting for its next chunk.
      beginSeed(entry);
      return;
    }
    // Attached (or re-attached) to a session with no live turn per the feed —
    // any overlay left from before a drop belongs to a turn that is over.
    if (entry.source.kind === "session" && !entry.isSeeding) entry.view.value = null;
  }

  function onDetached(entry: RegistryEntry): void {
    if (entry.disposed) return;
    entry.isAttached.value = false;
    // Whatever streamed before the drop is stale — the re-ack reseeds from the
    // rows (or clears, if the turn ended meanwhile).
    entry.seedGeneration += 1;
    entry.isSeeding = false;
    entry.isSeeded = false;
    entry.buffered = [];
  }

  function attachChannel(entry: RegistryEntry): void {
    const channel =
      entry.source.kind === "session"
        ? liveChannelKeys.session(entry.source.id)
        : liveChannelKeys.trace(entry.source.id);
    entry.releaseChannel = live.subscribe(channel, {
      onEvent: (event) => onEvent(entry, event as ChatTurnEvent),
      onSubscribed: () => onSubscribed(entry),
      onDetached: () => onDetached(entry),
      onEnded: () => onEnded(entry),
      onError: (error) => {
        if (entry.disposed) return;
        entry.errorText.value = error.message;
        entry.isAttached.value = false;
      },
    });
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
    const subscriberId = Symbol("live-turn-subscriber");
    if (entry === undefined) {
      const created: RegistryEntry = {
        source,
        refCount: 0,
        view: shallowRef(null),
        isAttached: shallowRef(false),
        hasEnded: shallowRef(false),
        errorText: shallowRef(null),
        fetchSnapshot: null,
        fetchSnapshotOwner: null,
        releaseChannel: null,
        disposed: false,
        buffered: [],
        isSeeding: false,
        isSeeded: false,
        seedGeneration: 0,
        turnGeneration: 0,
      };
      entry = created;
      entries.set(key, entry);
    }
    if (entry.fetchSnapshot === null && options.fetchSnapshot !== undefined) {
      entry.fetchSnapshot = options.fetchSnapshot;
      entry.fetchSnapshotOwner = subscriberId;
    }
    entry.refCount += 1;
    // Attached after the first subscriber registered its snapshot provider,
    // so an immediate seed on the ack reads through it.
    if (entry.releaseChannel === null) attachChannel(entry);

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
      entry.releaseChannel?.();
      entry.releaseChannel = null;
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
  /** How many entries are acked on the socket right now. */
  const attachedCount = computed(
    () => [...entries.values()].filter((entry) => entry.isAttached.value).length,
  );

  return { subscribe, activeCount, attachedCount };
});
