<script setup lang="ts">
import { computed } from "vue";
import {
  AgentActivityPane,
  ThreadSkeleton,
  deriveSettledAgentActivity,
  type AgentActivityLike,
} from "@vynel/ui";
import { useSessionDetail } from "../../composables/chat/use-session-detail.js";
import { useWatchedTurn } from "../../composables/chat/use-watched-turn.js";
import { useActivityStore } from "../../stores/activity-store.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// The agent-run pointer's landing (2026-08-18): the SAME sidebar a delegated
// task opens, showing the subagent's nested activity instead of a
// conversation — a subagent has no session; its record lives on the spawning
// Agent/Task call inside the host session. Live runs stream through the
// registry watch (one refcounted socket, attach-gated on a running turn); the
// call's persisted subagent fields cover everyone who arrives after.
const props = defineProps<{
  sessionId: string;
  toolUseId: string;
}>();

const activity = useActivityStore();

// A turn running in the host session — the poll fallback's gate, same rule
// SessionThreadView applies (rows persist per chunk server-side).
const hasTurnHere = computed(() =>
  Object.values(activity.serverTurns).some(
    (serverTurn) => serverTurn.sessionId === props.sessionId,
  ),
);

const detailQuery = useSessionDetail(
  { kind: "global" },
  () => props.sessionId,
  () => (hasTurnHere.value ? 4000 : false),
  () => "segment",
);

const spawningCall = computed(() => {
  const byMessage = detailQuery.data.value?.toolCallsByMessageId ?? {};
  for (const calls of Object.values(byMessage)) {
    const match = calls.find((call) => call.toolUseId === props.toolUseId);
    if (match !== undefined) return match;
  }
  return null;
});

const watchedTurn = useWatchedTurn({
  sessionId: () => props.sessionId,
  // This pane never renders a turn overlay of its own — the watch is live.
  isSuppressed: () => false,
  refetchDetail: async () => {
    const refetched = await detailQuery.refetch();
    if (refetched.error) throw refetched.error;
    return refetched.data ?? undefined;
  },
});

// The live fold's entry wins while the run streams; the persisted fields are
// the settled base — the same overlay rule the thread's pointers follow.
const activityView = computed<AgentActivityLike | null>(() => {
  const live = watchedTurn.view.value?.agentActivity[props.toolUseId];
  if (live !== undefined && (live.text !== "" || live.toolCalls.length > 0)) {
    return live;
  }
  const call = spawningCall.value;
  return call === null ? null : deriveSettledAgentActivity(call);
});

const isWorking = computed(() => spawningCall.value?.status === "started");
</script>

<template>
  <div class="agent-run-pane">
    <ThreadSkeleton v-if="detailQuery.isPending.value" class="pane-pad" />
    <p v-else-if="detailQuery.isError.value" class="pane-note is-error">
      {{ formatSdkError(detailQuery.error.value) }}
    </p>
    <template v-else>
      <AgentActivityPane
        v-if="activityView"
        class="pane-pad"
        :activity="activityView"
      />
      <p v-else-if="isWorking" class="pane-note">
        The agent is starting up — its activity lands here as it works.
      </p>
      <p v-else class="pane-note">No recorded activity for this agent run.</p>
    </template>
  </div>
</template>

<style scoped>
.agent-run-pane {
  min-height: 0;
  overflow-y: auto;
  background: var(--bg-shell);
}

.pane-pad {
  margin: 14px 16px;
}

.pane-note {
  margin: 24px 16px 0;
  color: var(--ink-3);
  font: 400 12.5px/1.6 var(--font-ui);
}

.pane-note.is-error {
  color: var(--danger);
}
</style>
