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
  applyTraceStreamEvent,
  createLiveTraceState,
} from "../delegations/fold-trace-stream.js";

// Watch ANY session live: attach to its SSE observe stream
// (`GET /sessions/:sessionId/stream`) and fold the ChatTurnEvents through the
// same pure fold the delegation trace uses. The stream emits frames only while
// a turn runs and closes each turn with `turn-stream-ended` — we detach there
// and keep the folded entries on screen (v1: no auto re-attach; reopening
// Watch attaches fresh). Every async resumption is identity-guarded so a
// superseded attach never touches the successor's state.
export function useSessionWatch(sessionId: MaybeRefOrGetter<string | null>) {
  const vynel = useVynel();
  const id = computed(() => toValue(sessionId));

  const state = ref(createLiveTraceState());
  const isStreaming = ref(false);
  const hasEnded = ref(false);
  const errorText = ref<string | null>(null);

  let abortController: AbortController | null = null;

  async function attach(target: string): Promise<void> {
    const controller = new AbortController();
    abortController = controller;
    isStreaming.value = true;
    hasEnded.value = false;
    errorText.value = null;
    const isCurrent = (): boolean => abortController === controller;
    try {
      const { data, response } = await vynel.GET(
        "/sessions/{sessionId}/stream",
        {
          params: { path: { sessionId: target } },
          parseAs: "stream",
          signal: controller.signal,
        },
      );
      if (!response.ok || !data)
        throw new Error(`session stream ${response.status}`);
      for await (const event of readChatTurnEvents(data)) {
        if (!isCurrent()) return; // superseded mid-stream — drop the late tail
        if (event.kind === "turn-stream-ended") {
          hasEnded.value = true;
          break;
        }
        state.value = applyTraceStreamEvent(state.value, event);
      }
    } catch (streamError) {
      // An abort is our own detach; anything else must be SAID, not swallowed.
      if (isCurrent() && !isAbortError(streamError)) {
        errorText.value =
          streamError instanceof Error
            ? streamError.message
            : "The live view dropped — close and watch again.";
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
    isStreaming.value = false;
    hasEnded.value = false;
    errorText.value = null;
    state.value = createLiveTraceState();
  }

  watch(
    id,
    (currentId, previousId) => {
      if (currentId === previousId) return;
      detach();
      if (currentId !== null) void attach(currentId);
    },
    { immediate: true },
  );
  onScopeDispose(detach);

  return {
    entries: computed(() => state.value.entries),
    agentActivity: computed(() => state.value.agentActivity),
    pendingApprovalToolName: computed(
      () => state.value.pendingApprovalToolName,
    ),
    isStreaming,
    hasEnded,
    errorText,
  };
}

function isAbortError(candidate: unknown): boolean {
  return candidate instanceof Error && candidate.name === "AbortError";
}
