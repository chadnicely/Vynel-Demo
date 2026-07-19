// The Watch panel's LIVE trace: the settled rows come from the trace fetch; the
// live tail rides the SSE observe stream (`root.streamTrace`) — token-level. The
// poll never fully stops: while the stream is attached it runs at a slow
// KEEP-ALIVE (settled rows advance under the stream — the mid-turn-attach case),
// and when the stream ends or DROPS it returns to the fast cadence (an explicit
// refetch re-evaluates the interval; TanStack only re-evaluates on query updates).
//
// Merge model: server entries are authoritative by id; overlay entries (still
// streaming) append after them. When the stream ends (`turn-stream-ended`), one
// settle refetch replaces the overlay with the persisted rows and the overlay
// clears. Every async resumption is identity-guarded — a superseded attach
// (re-target, unmount) must never touch the successor's state.

import {
  computed,
  ref,
  toValue,
  watch,
  onScopeDispose,
  type MaybeRefOrGetter,
} from "vue";
import { useVynel } from "../use-vynel.js";
import { readChatTurnEvents } from "../chat/chat-turn-stream.js";
import { useDelegationTrace } from "./use-delegation-trace.js";
import {
  applyTraceStreamEvent,
  createLiveTraceState,
  mergeTraceEntries,
  type LiveTraceEntry,
} from "./fold-trace-stream.js";

export function useDelegationTraceLive(
  partialSessionId: MaybeRefOrGetter<string | null>,
) {
  const vynel = useVynel();
  const id = computed(() => toValue(partialSessionId));

  const isStreaming = ref(false);
  const streamState = ref(createLiveTraceState());
  const traceQuery = useDelegationTrace(partialSessionId, () => isStreaming.value);

  let abortController: AbortController | null = null;
  let attachedFor: string | null = null;

  async function attach(traceId: string): Promise<void> {
    attachedFor = traceId;
    const controller = new AbortController();
    abortController = controller;
    isStreaming.value = true;
    const isCurrent = (): boolean => abortController === controller;
    try {
      const { data, response } = await vynel.GET(
        "/root/trace/{partialSessionId}/stream",
        {
          params: { path: { partialSessionId: traceId } },
          parseAs: "stream",
          signal: controller.signal,
        },
      );
      if (!response.ok || !data) throw new Error(`observe stream ${response.status}`);
      for await (const event of readChatTurnEvents(data)) {
        if (!isCurrent()) return; // superseded mid-stream — drop the late tail
        if (event.kind === "turn-stream-ended") break;
        streamState.value = applyTraceStreamEvent(streamState.value, event);
      }
      if (!isCurrent()) return;
      // Settle: flip streaming OFF first so the refetch's completion re-evaluates
      // the interval with the fast cadence, then swap the overlay for the
      // persisted rows (attribution included).
      isStreaming.value = false;
      await traceQuery.refetch();
      if (!isCurrent()) return;
      streamState.value = createLiveTraceState();
    } catch {
      // Dropped or refused — restore fast polling. The refetch is what makes the
      // interval re-evaluate; without it the suspension would stick forever.
      if (isCurrent()) {
        isStreaming.value = false;
        void traceQuery.refetch();
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
    streamState.value = createLiveTraceState();
  }

  // Attach while the delegation is live; re-attach on a new watch target. A
  // dropped stream does NOT re-attach for the same target (attachedFor stays) —
  // fast polling carries the rest of that job; reconnect-with-backoff is a
  // noted follow-on.
  watch(
    [id, () => traceQuery.data.value?.status],
    ([currentId, status]) => {
      if (currentId === null) {
        detach();
        return;
      }
      if (attachedFor !== null && attachedFor !== currentId) detach();
      const isLive = status === "pending" || status === "claimed";
      if (isLive && attachedFor !== currentId) void attach(currentId);
    },
    { immediate: true },
  );
  onScopeDispose(detach);

  const entries = computed<LiveTraceEntry[]>(() =>
    mergeTraceEntries(
      traceQuery.data.value?.entries ?? [],
      streamState.value.entries,
    ),
  );
  const pendingApprovalToolName = computed(
    () => streamState.value.pendingApprovalToolName,
  );
  // Spawned subagents' LIVE activity — drives the trace list's one-line
  // ticker + the focused view while the stream is attached. Settled runs
  // render from the tool call's persisted subagent fields instead (the
  // focused view's fallback).
  const agentActivity = computed(() => streamState.value.agentActivity);

  return {
    traceQuery,
    entries,
    pendingApprovalToolName,
    agentActivity,
    isStreaming,
  };
}
