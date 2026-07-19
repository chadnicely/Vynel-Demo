<script setup lang="ts">
import { computed } from "vue";
import MarkdownText from "./MarkdownText.vue";
import PresenceDot from "./PresenceDot.vue";
import { describeAgentActivityCall } from "../tool-cards/subagent-activity.js";

// A subagent's FULL activity — the Watch focused view's body (live from the
// turn's stream while it runs; from the Agent call's persisted subagent
// fields after settle). The thread never renders this pane: an in-thread
// Agent card shows only ToolCallList's one-line live ticker (Chad's space
// call — parallel agents must not flood the transcript), and Watch is the
// way into the detail.

export interface AgentActivityToolCallLike {
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
  status: "started" | "completed" | "failed";
}

export interface AgentActivityLike {
  text: string;
  toolCalls: AgentActivityToolCallLike[];
}

const props = defineProps<{
  activity: AgentActivityLike;
}>();

const isWorking = computed(() =>
  props.activity.toolCalls.some((call) => call.status === "started"),
);
</script>

<template>
  <div class="agent-activity" aria-label="Agent activity">
    <p class="activity-heading">
      <PresenceDot :state="isWorking ? 'live' : 'idle'" />
      Agent activity
    </p>
    <ul v-if="props.activity.toolCalls.length > 0" class="activity-calls">
      <li
        v-for="call in props.activity.toolCalls"
        :key="call.toolUseId"
        class="activity-call"
        :class="{ 'is-failed': call.status === 'failed' }"
      >
        <span class="call-status" :class="`is-${call.status}`" aria-hidden="true" />
        <span class="sr-only">{{ call.status }}:</span>
        <span class="call-text">{{ describeAgentActivityCall(call) }}</span>
      </li>
    </ul>
    <div v-if="props.activity.text" class="activity-text">
      <MarkdownText :source="props.activity.text" />
    </div>
  </div>
</template>

<style scoped>
.agent-activity {
  margin-left: 10px;
  padding: 8px 10px 8px 12px;
  border-left: 2px solid var(--hair-strong);
  display: grid;
  gap: 6px;
}

.activity-heading {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ink-3);
  font: 600 10.5px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.07em;
}

.activity-calls {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 3px;
}

.activity-call {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ink-2);
  font: 500 12px/1.5 var(--font-mono);
}

/* Its own flex item so the ellipsis actually renders on overflow. */
.call-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activity-call.is-failed {
  color: var(--danger);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.call-status {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 99px;
  background: var(--ink-3);
}

.call-status.is-started {
  background: var(--gold);
  animation: call-status-breathe 1.6s var(--ease-out) infinite;
}

.call-status.is-completed {
  background: var(--ok);
}

.call-status.is-failed {
  background: var(--danger);
}

@keyframes call-status-breathe {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

@media (prefers-reduced-motion: reduce) {
  .call-status.is-started {
    animation: none;
  }
}

/* The agent's narrative can run long — bounded, newest visible by scroll. */
.activity-text {
  max-height: 260px;
  overflow-y: auto;
  color: var(--ink-2);
  font-size: 12.5px;
}
</style>
