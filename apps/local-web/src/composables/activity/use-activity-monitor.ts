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
//     = the session channel. Attaches immediately (an idle attach waits for the
//     next turn); v1 keeps one-attach-one-turn — no auto re-attach after
//     `turn-stream-ended` (reopening attaches fresh).
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
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from "vue";
import { useVynel } from "../use-vynel.js";
import { readChatTurnEvents } from "../chat/chat-turn-stream.js";
import {
  useDelegationTrace,
  TRACE_KEEP_ALIVE_MS,
} from "../delegations/use-delegation-trace.js";
import { useSessionDetail } from "../chat/use-session-detail.js";
import {
  applyTraceStreamEvent,
  createLiveTraceState,
  mergeTraceEntries,
  type LiveTraceEntry,
} from "../delegations/fold-trace-stream.js";

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

  const streamState = ref(createLiveTraceState());
  const isStreaming = ref(false);
  const hasEnded = ref(false);
  const errorText = ref<string | null>(null);

  // The settled halves — only the matching kind's query is ever enabled (the
  // other's id computed stays null). The monitor reads EVERY session through
  // `root.getSession` (owner-gated, any scope), so the detail scope is fixed.
  const traceQuery = useDelegationTrace(traceId, () => isStreaming.value);
  const transcriptQuery = useSessionDetail({ kind: "global" }, sessionId, () =>
    isStreaming.value ? TRACE_KEEP_ALIVE_MS : false,
  );

  function settledRefetch(target: ActivitySource): Promise<unknown> {
    return target.kind === "trace"
      ? traceQuery.refetch()
      : transcriptQuery.refetch();
  }

  let abortController: AbortController | null = null;
  // "<kind>:<id>" while attached (or after a natural end/drop for that target —
  // deliberately NOT cleared then, so the same target never auto re-attaches;
  // the trace poll carries a dropped job, and a session reopens fresh).
  let attachedFor: string | null = null;

  async function attach(target: ActivitySource): Promise<void> {
    attachedFor = sourceKey(target);
    const controller = new AbortController();
    abortController = controller;
    isStreaming.value = true;
    hasEnded.value = false;
    errorText.value = null;
    const isCurrent = (): boolean => abortController === controller;
    try {
      const { data, response } =
        target.kind === "trace"
          ? await vynel.GET("/root/trace/{partialSessionId}/stream", {
              params: { path: { partialSessionId: target.id } },
              parseAs: "stream",
              signal: controller.signal,
            })
          : await vynel.GET("/sessions/{sessionId}/stream", {
              params: { path: { sessionId: target.id } },
              parseAs: "stream",
              signal: controller.signal,
            });
      if (!response.ok || !data)
        throw new Error(`activity stream ${response.status}`);
      for await (const event of readChatTurnEvents(data)) {
        if (!isCurrent()) return; // superseded mid-stream — drop the late tail
        if (event.kind === "turn-stream-ended") {
          hasEnded.value = true;
          break;
        }
        streamState.value = applyTraceStreamEvent(streamState.value, event);
      }
      if (!isCurrent()) return;
      // Settle: flip streaming OFF first (the trace poll interval re-evaluates
      // on the refetch's completion), then swap the overlay for persisted rows.
      isStreaming.value = false;
      await settledRefetch(target);
      if (!isCurrent()) return;
      streamState.value = createLiveTraceState();
    } catch (streamError) {
      // An abort is our own detach; a real drop must be SAID — and refetched:
      // the explicit refetch is what re-arms the trace's fast poll (TanStack
      // re-evaluates refetchInterval only on query updates) and freshens the
      // session transcript.
      if (isCurrent() && !isAbortError(streamError)) {
        errorText.value =
          streamError instanceof Error
            ? streamError.message
            : "The live view dropped — close and watch again.";
        isStreaming.value = false;
        void settledRefetch(target);
      }
    } finally {
      if (isCurrent()) {
        isStreaming.value = false;
        abortController = null;
      }
    }
  }

  function detach(): void {
    abortController?.abort();
    abortController = null;
    attachedFor = null;
    isStreaming.value = false;
    hasEnded.value = false;
    errorText.value = null;
    streamState.value = createLiveTraceState();
  }

  // Attach policy per kind: a session attaches immediately (idle attach waits
  // for the next turn); a trace attaches only while its job is live. A
  // re-target always detaches the predecessor first.
  watch(
    [resolved, () => traceQuery.data.value?.status],
    ([current, status]) => {
      if (current === null || current === undefined) {
        detach();
        return;
      }
      const key = sourceKey(current);
      if (attachedFor !== null && attachedFor !== key) detach();
      if (current.kind === "session") {
        if (attachedFor !== key) void attach(current);
        return;
      }
      const isLive = status === "pending" || status === "claimed";
      if (isLive && attachedFor !== key) void attach(current);
    },
    { immediate: true },
  );
  onScopeDispose(detach);

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
      mergeTraceEntries(settledEntries.value, streamState.value.entries),
    ),
    agentActivity: computed(() => streamState.value.agentActivity),
    pendingApprovalToolName: computed(
      () => streamState.value.pendingApprovalToolName,
    ),
    isStreaming,
    hasEnded,
    errorText,
    /** The trace-kind settled query — job status / Stop affordances. */
    traceQuery,
    /** The session-kind settled query — the transcript envelope. */
    transcriptQuery,
  };
}
