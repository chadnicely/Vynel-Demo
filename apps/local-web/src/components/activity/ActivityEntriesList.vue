<script setup lang="ts">
import { computed } from "vue";
import {
  MarkdownText,
  PresenceDot,
  ToolCallList,
  type AgentActivityLike,
} from "@vynel/ui";
import type { ChatToolCallResponse } from "@vynel/contracts/chat/chat-http";
import type { LiveTraceEntry } from "../../composables/delegations/fold-trace-stream.js";

// The merged panel's entries body — one list for both source kinds, keeping
// each kind's established states: a trace is status-driven (loading, queued
// empty, no-activity), a session is stream-driven (watching live, still
// working, caught up). Every Agent card carries a Watch chip — the host turns
// it into a drill-down push.
const props = defineProps<{
  kind: "trace" | "session";
  entries: LiveTraceEntry[];
  agentActivity: Record<string, AgentActivityLike>;
  pendingApprovalToolName: string | null;
  errorText: string | null;
  /** Trace kind: the settled trace read is still loading. */
  isLoading: boolean;
  /** Trace kind: the job is pending/claimed. */
  isWorking: boolean;
  /** Session kind: the observe stream is attached. */
  isStreaming: boolean;
  /** Session kind: the watched turn ended (one-attach-one-turn). */
  hasEnded: boolean;
}>();

const emit = defineEmits<{
  watchAgent: [toolUseId: string];
}>();

// Persona-first author labels, matching MessageRow: the brain is Claude, a
// workspace persona speaks by its own label — no "Assistant · X" prefix.
function authorLabel(entry: LiveTraceEntry): string {
  if (entry.role === "user")
    return entry.sourceKind === "global-root" ? "From Claude" : "You";
  return entry.sourceLabel ?? "Assistant";
}

// The instruction that started a delegation reads differently from the
// replies — trace kind gives it the task-card treatment.
function isTaskEntry(entry: LiveTraceEntry): boolean {
  return props.kind === "trace" && entry.role === "user";
}

function onWatchAgent(toolCall: ChatToolCallResponse) {
  emit("watchAgent", toolCall.toolUseId);
}

const emptyNote = computed(() => {
  if (props.kind === "trace") {
    return props.isWorking
      ? "The workspace is working — its activity appears here as it's recorded."
      : "No activity recorded for this task.";
  }
  return props.hasEnded
    ? "The reply finished — you're all caught up."
    : "Watching live — the moment something runs here, it shows up.";
});

const stillWorking = computed(() =>
  props.kind === "trace" ? props.isWorking : props.isStreaming,
);

const approvalNote = computed(() =>
  props.kind === "trace"
    ? "the task is paused until you decide."
    : "the reply is paused until you decide.",
);
</script>

<template>
  <p v-if="props.errorText" class="state-note is-error">
    {{ props.errorText }}
  </p>
  <p v-else-if="props.kind === 'trace' && props.isLoading" class="state-note">
    Loading…
  </p>
  <p v-else-if="props.entries.length === 0" class="state-note">
    {{ emptyNote }}
  </p>
  <div v-else class="trace">
    <div
      v-for="entry in props.entries"
      :key="entry.id"
      class="entry"
      :class="{ 'is-task': isTaskEntry(entry) }"
    >
      <p class="entry-author">{{ authorLabel(entry) }}</p>
      <!-- A running spawned agent shows its one-line live ticker under its
           card, same as the chat thread; the full activity is one drill-in
           away (the card's Watch chip → the focused agent node). -->
      <ToolCallList
        v-if="entry.toolCalls.length > 0"
        class="entry-tools"
        :tool-calls="entry.toolCalls"
        :agent-activity="props.agentActivity"
        watchable-agents
        @watch-agent="onWatchAgent"
      />
      <MarkdownText :source="entry.body" />
    </div>
    <p v-if="props.pendingApprovalToolName" class="working-note is-approval">
      <PresenceDot state="live" />
      Waiting for your approval: {{ props.pendingApprovalToolName }} —
      {{ approvalNote }}
    </p>
    <p v-else-if="stillWorking" class="working-note">
      <PresenceDot state="live" /> Still working…
    </p>
    <p
      v-else-if="props.kind === 'session' && props.hasEnded"
      class="state-note"
    >
      The reply finished — you're all caught up.
    </p>
  </div>
</template>

<style scoped>
.trace {
  max-width: 760px;
  margin: 0 auto;
  display: grid;
  gap: 18px;
}

.entry {
  display: grid;
  gap: 6px;
}

/* The instruction that STARTED the task — a quoted card, visually distinct
   from the assistant's replies below it. */
.entry.is-task {
  padding: 10px 14px;
  border: 1px solid var(--hair);
  border-left: 3px solid var(--hair-strong);
  border-radius: var(--radius-m);
  background: var(--bg-raised);
}

.entry-author {
  margin: 0;
  color: var(--ink-3);
  font: 600 10.5px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.07em;
}

.state-note {
  margin: 16px 0 0;
  text-align: center;
  color: var(--ink-3);
  font: 400 12.5px/1.6 var(--font-ui);
}

.state-note.is-error {
  color: var(--danger);
}

.working-note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 2px 0 0;
  color: var(--ink-2);
  font: 500 12px/1.5 var(--font-ui);
}

/* Needs-you moment — the one gold banner in the panel. */
.working-note.is-approval {
  padding: 9px 12px;
  border: 1px solid var(--gold-soft);
  border-radius: var(--radius-m);
  background: var(--gold-soft);
  color: var(--ink-1);
  font-weight: 600;
}
</style>
