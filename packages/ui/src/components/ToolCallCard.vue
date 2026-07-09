<script setup lang="ts">
import { computed, ref } from "vue";
import type { ChatToolCallResponse } from "@vynel/contracts/chat/chat-http";
import { presentToolCall } from "../tool-cards/tool-presenters.js";
import PresenceDot from "./PresenceDot.vue";
import ToolCallDetail from "./ToolCallDetail.vue";

// One card for every tool the assistant uses, presented the way Claude Code
// does: a compact chip ("Wrote pricing.md +12") that expands into the real
// artifact (ToolCallDetail — path header, unified diff, terminal, content).
// Unknown/MCP tools humanize their name and fall back to payload panes.
const props = defineProps<{
  toolCall: ChatToolCallResponse;
  initiallyExpanded?: boolean;
}>();

const isExpanded = ref(props.initiallyExpanded ?? false);

const presentation = computed(() => presentToolCall(props.toolCall));

const statusTone = computed(() => {
  if (props.toolCall.status === "started") return "running";
  if (props.toolCall.status === "completed")
    return props.toolCall.isErrorResult ? "error" : "ok";
  if (props.toolCall.status === "cancelled") return "muted";
  return "error"; // failed | denied
});

// The chip only spells out a status that needs attention — a clean completion
// is already told by the quiet green dot.
const statusLabel = computed(() => {
  if (props.toolCall.status === "started") return "running";
  if (props.toolCall.status === "completed")
    return props.toolCall.isErrorResult ? "error" : null;
  return props.toolCall.status;
});

const durationLabel = computed(() => {
  if (!props.toolCall.completedAt) return null;
  const elapsedMs =
    new Date(props.toolCall.completedAt).getTime() -
    new Date(props.toolCall.startedAt).getTime();
  if (elapsedMs < 1000) return `${elapsedMs}ms`;
  return `${(elapsedMs / 1000).toFixed(1)}s`;
});
</script>

<template>
  <div class="tool-call-card" :class="{ 'is-expanded': isExpanded }">
    <button
      type="button"
      class="summary"
      :aria-expanded="isExpanded"
      @click="isExpanded = !isExpanded"
    >
      <PresenceDot
        v-if="statusTone === 'running'"
        state="live"
        :label="`${presentation.verb} running`"
      />
      <span v-else class="status-dot" :class="`tone-${statusTone}`" />
      <span class="verb">{{ presentation.verb }}</span>
      <span v-if="presentation.argument" class="argument">{{
        presentation.argument
      }}</span>
      <span v-if="presentation.stats" class="stats">
        <span v-if="presentation.stats.added > 0" class="stat-added"
          >+{{ presentation.stats.added }}</span
        >
        <span v-if="presentation.stats.removed > 0" class="stat-removed"
          >-{{ presentation.stats.removed }}</span
        >
      </span>
      <span class="meta">
        <span v-if="durationLabel">{{ durationLabel }}</span>
        <span v-if="statusLabel" class="status-text">{{ statusLabel }}</span>
      </span>
      <svg
        class="caret"
        :class="{ 'is-open': isExpanded }"
        width="11"
        height="11"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M3 6l5 5 5-5"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    <ToolCallDetail v-if="isExpanded" :presentation="presentation" />
  </div>
</template>

<style scoped>
/* Collapsed, the card is a compact chip sized to its words; expanded it
   stretches to carry the artifact full-width. */
.tool-call-card {
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  background: var(--bg-panel);
  overflow: hidden;
  justify-self: start;
  max-width: 100%;
}

.tool-call-card.is-expanded {
  justify-self: stretch;
}

.summary {
  appearance: none;
  border: 0;
  margin: 0;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  background: transparent;
  cursor: default;
  text-align: left;
}

.summary:hover {
  background: var(--row-hover);
}

.summary:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: -2px;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}

.tone-ok {
  background: var(--ok);
}

.tone-error {
  background: var(--danger);
}

.tone-muted {
  background: var(--ink-3);
}

.verb {
  color: var(--ink-2);
  font: 400 12.5px/1.5 var(--font-ui);
  flex: none;
  white-space: nowrap;
}

.argument {
  color: var(--ink-1);
  font: 600 12px/1.5 var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 46ch;
}

.stats {
  display: inline-flex;
  gap: 6px;
  flex: none;
  font: 600 11px/1.5 var(--font-mono);
}

.stat-added {
  color: var(--ok);
}

.stat-removed {
  color: var(--danger);
}

.meta {
  margin-left: auto;
  display: flex;
  gap: 10px;
  flex: none;
  color: var(--ink-3);
  font: 400 11px/1.5 var(--font-ui);
  padding-left: 10px;
}

.status-text {
  color: var(--ink-2);
}

.caret {
  flex: none;
  color: var(--ink-3);
  transition: transform var(--t-fast) var(--ease-out);
}

.caret.is-open {
  transform: rotate(180deg);
}

@media (prefers-reduced-motion: reduce) {
  .caret {
    transition: none;
  }
}
</style>
