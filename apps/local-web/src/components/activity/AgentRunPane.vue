<script setup lang="ts">
import { computed } from "vue";
import {
  AgentActivityPane,
  MarkdownText,
  ThreadSkeleton,
  deriveSettledAgentActivity,
  type AgentActivityLike,
} from "@vynel/ui";
import type { ChatToolCallResponse } from "@vynel/contracts/chat/chat-http";
import { useSessionDetail } from "../../composables/chat/use-session-detail.js";
import { useWatchedTurn } from "../../composables/chat/use-watched-turn.js";
import { useActivityStore } from "../../stores/activity-store.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import { agentRunInstruction, agentRunResultText } from "./agent-run-instruction.js";

// The agent-run pointer's landing (2026-08-18): the SAME sidebar a delegated
// task opens, showing the subagent's nested activity instead of a
// conversation — a subagent has no session; its record lives on the spawning
// Agent/Task call inside the host session. Live runs stream through the
// registry watch (one refcounted socket, attach-gated on a running turn); the
// call's persisted subagent fields cover everyone who arrives after.
//
// Three parts, top to bottom (Kafi, 2026-08-26: the pane IS the agent's
// card now — the thread shows only the pointer): what it was ASKED (the
// spawning call's brief), what it DID (the nested activity), and what it
// ANSWERED (the call's settled output — the agent's final report).
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

// The spawning call: the live fold's copy first (it carries the brief from
// the first frame, before the row reaches the detail read — a click seconds
// after the spawn must not open on "no recorded activity"), else the
// persisted row.
const liveCall = computed<ChatToolCallResponse | null>(
  () =>
    watchedTurn.view.value?.segments
      .flatMap((segment) => segment.toolCalls)
      .find((call) => call.toolUseId === props.toolUseId) ?? null,
);
const persistedCall = computed<ChatToolCallResponse | null>(() => {
  const byMessage = detailQuery.data.value?.toolCallsByMessageId ?? {};
  for (const calls of Object.values(byMessage)) {
    const match = calls.find((call) => call.toolUseId === props.toolUseId);
    if (match !== undefined) return match;
  }
  return null;
});
const spawningCall = computed(() => liveCall.value ?? persistedCall.value);

const instruction = computed(() => agentRunInstruction(spawningCall.value?.toolInput));

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

// The answer — only once the call settled; a running agent's output is null.
const resultText = computed(() => {
  const call = spawningCall.value;
  if (call === null || call.status === "started") return null;
  return agentRunResultText(call.toolOutput);
});

// How the run ended, in the heading's one word: a clean answer, a failure
// (the tool errored, or completed with an error result), a user stop, or a
// refusal (denied / blocked) — each is a different thing to tell the person.
const resultHeading = computed(() => {
  const call = spawningCall.value;
  if (call === null || call.status === "started") return null;
  if (call.status === "completed") return call.isErrorResult ? "Failed" : "Result";
  if (call.status === "failed") return "Failed";
  if (call.status === "cancelled") return "Stopped";
  return "Not allowed";
});
const resultFailed = computed(() => resultHeading.value !== null && resultHeading.value !== "Result");
</script>

<template>
  <div class="agent-run-pane">
    <ThreadSkeleton
      v-if="detailQuery.isPending.value && spawningCall === null"
      class="pane-pad"
    />
    <p
      v-else-if="detailQuery.isError.value && spawningCall === null"
      class="pane-note is-error"
    >
      {{ formatSdkError(detailQuery.error.value) }}
    </p>
    <template v-else>
      <section v-if="instruction" class="pane-pad instruction" aria-label="Instruction">
        <p class="section-heading">
          Instruction
          <span v-if="instruction.agentType" class="agent-type">{{ instruction.agentType }}</span>
        </p>
        <p v-if="instruction.description" class="instruction-title">
          {{ instruction.description }}
        </p>
        <pre v-if="instruction.prompt" class="instruction-prompt">{{ instruction.prompt }}</pre>
      </section>
      <AgentActivityPane
        v-if="activityView"
        class="pane-pad"
        :activity="activityView"
      />
      <p v-else-if="isWorking" class="pane-note">
        The agent is starting up — its activity lands here as it works.
      </p>
      <p v-else-if="!instruction" class="pane-note">No recorded activity for this agent run.</p>
      <section v-if="resultText" class="pane-pad result" aria-label="Result">
        <p class="section-heading" :class="{ 'is-failed': resultFailed }">
          {{ resultHeading }}
        </p>
        <div class="result-body">
          <MarkdownText :source="resultText" />
        </div>
      </section>
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

.section-heading {
  margin: 0 0 6px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ink-3);
  font: 600 10.5px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.07em;
}

.section-heading.is-failed {
  color: var(--danger);
}

.agent-type {
  padding: 1px 7px;
  border: 1px solid var(--hair-strong);
  border-radius: 999px;
  color: var(--ink-2);
  font: 500 10px/1.5 var(--font-ui);
  letter-spacing: 0;
  text-transform: none;
}

.instruction-title {
  margin: 0 0 6px;
  color: var(--ink-1);
  font: 500 12.5px/1.5 var(--font-ui);
}

/* The brief can run long — bounded, scrolls, keeps its line breaks. */
.instruction-prompt {
  margin: 0;
  max-height: 220px;
  overflow: auto;
  padding: 8px 10px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  background: var(--bg-panel);
  color: var(--ink-2);
  font: 400 12px/1.55 var(--font-ui);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.result-body {
  padding: 8px 10px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  background: var(--bg-panel);
  color: var(--ink-1);
  font-size: 12.5px;
}
</style>
