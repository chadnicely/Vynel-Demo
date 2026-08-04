// The ONE activity source seam (sessions-surface Slice ①): every watch surface
// registers a SOURCE and gets the same merged state — the settled history ("old
// activity") plus the live overlay — instead of each surface hand-wiring its own
// fetch + SSE + fold. The merged activity panel (Slice ②) consumes it directly;
// the Slice-① thin adapters are gone with their panels.
//
// Source kinds:
//   - 'trace'   — a delegation, keyed by its partialSessionId. Settled = the
//     condensed trace read (status-polled while live); stream = the observe
//     route. Attaches only while the job is pending/claimed.
//   - 'session' — any owned session, keyed by its SDK session id. Settled = the
//     full transcript (`root.getSession` — owner-gated, scope-agnostic); stream
//     = the session channel via the SHARED live-turn registry (B3): the watch
//     RE-ATTACHES across turns now — the v1 one-attach-one-turn limit is gone.
//
// Merge model (shared): settled rows are authoritative by id; overlay rows
// append. While a stream is attached the settled query keeps a slow KEEP-ALIVE
// poll — a mid-turn attach fetches a partial assistant row the overlay cannot
// extend (its deltas start post-attach), so only advancing settled rows unfreeze
// it. On `turn-stream-ended` one settle refetch swaps the overlay for the
// persisted rows. Every async resumption is identity-guarded.

import {
  computed,
  onScopeDispose,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from "vue";
import { useVynel } from "../use-vynel.js";
import {
  useDelegationTrace,
  TRACE_KEEP_ALIVE_MS,
} from "../delegations/use-delegation-trace.js";
import {
  useLiveTurnRegistry,
  type LiveTurnSubscription,
} from "../../stores/live-turn-registry.js";
import { useSessionDetail } from "../chat/use-session-detail.js";
import {
  mergeTraceEntries,
  type LiveTraceEntry,
} from "../delegations/fold-trace-stream.js";
import {
  applyChatTurnEvent,
  createActiveTurnView,
} from "../chat/active-turn-view.js";
import {
  liveEntriesFromTurnView,
  pendingApprovalToolNameOf,
} from "./turn-view-entries.js";

export type ActivitySource =
  | { kind: "trace"; id: string }
  | { kind: "session"; id: string };

function sourceKey(source: ActivitySource): string {
  return `${source.kind}:${source.id}`;
}

function isAbortError(candidate: unknown): boolean {
  return candidate instanceof Error && candidate.name === "AbortError";
}

export function useActivityMonitor(
  source: MaybeRefOrGetter<ActivitySource | null>,
) {
  const vynel = useVynel();
  const resolved = computed(() => toValue(source));
  const traceId = computed(() =>
    resolved.value?.kind === "trace" ? resolved.value.id : null,
  );
  const sessionId = computed(() =>
    resolved.value?.kind === "session" ? resolved.value.id : null,
  );

  // B2: the FULL chat fold — thinking, lifecycle, errors, and usage are no
  // longer dropped in watch views. B3: the fold lives in the SHARED registry
  // (one SSE per source, refcounted); this composable manages only which
  // source is subscribed and projects the shared view.
  const registry = useLiveTurnRegistry();
  // shallowRef — a deep ref would unwrap the subscription's nested refs.
  const subscription = shallowRef<LiveTurnSubscription | null>(null);
  const streamView = computed(
    () => subscription.value?.view.value ?? createActiveTurnView(),
  );
  const isStreaming = computed(() => subscription.value?.isAttached.value ?? false);
  const hasEnded = computed(() => subscription.value?.hasEnded.value ?? false);
  const errorText = computed(() => subscription.value?.errorText.value ?? null);

  // The settled halves — only the matching kind's query is ever enabled (the
  // other's id computed stays null). The monitor reads EVERY session through
  // `root.getSession` (owner-gated, any scope), so the detail scope is fixed.
  const traceQuery = useDelegationTrace(traceId, () => isStreaming.value);
  const transcriptQuery = useSessionDetail({ kind: "global" }, sessionId, () =>
    isStreaming.value ? TRACE_KEEP_ALIVE_MS : false,
  );

  // The registry's seed/settle snapshot provider, BOUND to its target at
  // subscribe time (a closure reading `resolved` would fetch the WRONG target
  // after a re-target while the entry outlives this subscription). While the
  // monitor still shows the target, its own query is the single fetcher
  // (refresh + return); after a re-target the entry's rows come from a direct
  // owner-gated read instead.
  function makeFetchSnapshot(target: ActivitySource) {
    return async () => {
      const current = resolved.value;
      const stillMine =
        current !== null && current.kind === target.kind && current.id === target.id;
      if (target.kind === "trace") {
        if (stillMine) await traceQuery.refetch();
        return undefined; // trace sources never seed — live-only overlay
      }
      if (stillMine) {
        const result = await transcriptQuery.refetch();
        const detail = result.data;
        return detail === undefined
          ? undefined
          : {
              messages: detail.messages,
              toolCallsByMessageId: detail.toolCallsByMessageId,
            };
      }
      try {
        const detail = await vynel.root.getSession(target.id);
        return {
          messages: detail.messages,
          toolCallsByMessageId: detail.toolCallsByMessageId,
        };
      } catch {
        // A failed seed aborts THIS seed only — the loop retries on the next event.
        return undefined;
      }
    };
  }

  let subscribedFor: string | null = null;
  function releaseSubscription(): void {
    subscription.value?.release();
    subscription.value = null;
    subscribedFor = null;
  }

  // Attach policy per kind (unchanged): a session subscribes immediately (an
  // idle attach waits for the next turn — and now re-attaches across turns); a
  // trace subscribes only while its job is live, and releases when the status
  // poll settles it (the registry's trace streams are one-attach-per-run).
  watch(
    [resolved, () => traceQuery.data.value?.status],
    ([current, status]) => {
      if (current === null || current === undefined) {
        releaseSubscription();
        return;
      }
      const key = sourceKey(current);
      // The predecessor releases UNCONDITIONALLY on a re-target — a stale
      // subscription surviving into a not-yet-live trace would bleed the old
      // source's fold into the new target's entries.
      if (subscribedFor !== null && subscribedFor !== key) releaseSubscription();
      if (current.kind === "session") {
        if (subscribedFor === key) return;
        subscription.value = registry.subscribe(current, {
          fetchSnapshot: makeFetchSnapshot(current),
        });
        subscribedFor = key;
        return;
      }
      const isLive = status === "pending" || status === "claimed";
      if (isLive) {
        if (subscribedFor === key) return;
        subscription.value = registry.subscribe(current, {
          fetchSnapshot: makeFetchSnapshot(current),
        });
        subscribedFor = key;
      } else if (subscribedFor === key) {
        // The job settled — refresh the settled trace, drop the live overlay.
        releaseSubscription();
        void traceQuery.refetch();
      }
    },
    { immediate: true },
  );
  onScopeDispose(releaseSubscription);

  // Trace lifecycle glue the registry deliberately doesn't own: a trace's
  // settled read is THIS composable's query, so its end/drop must re-arm the
  // poll here (TanStack re-evaluates refetchInterval only on query updates —
  // without the explicit refetch a dropped trace would stop advancing). On a
  // SETTLED trace the subscription is released after the refetch — the settled
  // rows are the story now, and a trace stream is one-attach-per-run.
  watch(
    [hasEnded, errorText],
    async ([ended, error]) => {
      if (resolved.value?.kind !== "trace") return;
      if (!ended && error === null) return;
      // Captured BEFORE the await: a re-target during the refetch swaps the
      // subscription, and a late release must never kill the successor.
      const mine = subscription.value;
      await traceQuery.refetch();
      if (ended && subscription.value === mine) releaseSubscription();
    },
  );

  const settledEntries = computed<LiveTraceEntry[]>(() => {
    const current = resolved.value;
    if (current === null) return [];
    if (current.kind === "trace") return traceQuery.data.value?.entries ?? [];
    const detail = transcriptQuery.data.value;
    if (detail === undefined) return [];
    return detail.messages.map((message) => ({
      id: message.id,
      role: message.role,
      sourceKind: message.sourceKind ?? null,
      sourceLabel: message.sourceLabel ?? null,
      body: message.body,
      toolCalls: detail.toolCallsByMessageId[message.id] ?? [],
    }));
  });

  return {
    entries: computed(() =>
      mergeTraceEntries(
        settledEntries.value,
        liveEntriesFromTurnView(streamView.value),
      ),
    ),
    agentActivity: computed(() => streamView.value.agentActivity),
    pendingApprovalToolName: computed(() =>
      pendingApprovalToolNameOf(streamView.value),
    ),
    /** The live turn's terminal error (session-errored) — previously eaten by
     *  the panel's own fold; the panel can now SAY it. */
    turnError: computed(() => streamView.value.error),
    isStreaming,
    hasEnded,
    errorText,
    /** The trace-kind settled query — job status / Stop affordances. */
    traceQuery,
    /** The session-kind settled query — the transcript envelope. */
    transcriptQuery,
  };
}
