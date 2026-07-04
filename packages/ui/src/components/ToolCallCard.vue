<script setup lang="ts">
import { computed, ref } from "vue";
import type { ChatToolCallResponse } from "@vynel/contracts/chat/chat-http";
import { presentToolCall } from "../tool-cards/tool-presenters.js";
import PresenceDot from "./PresenceDot.vue";
import CodeBlock from "./CodeBlock.vue";

// One card for every tool the assistant uses — tool-aware: "Read pricing.md"
// with highlighted file content, an Edit as a diff, a Bash as a terminal.
// Unknown/MCP tools fall back to input/output payload panes.
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

const statusLabel = computed(() =>
  props.toolCall.status === "started" ? "running" : props.toolCall.status,
);

const durationLabel = computed(() => {
  if (!props.toolCall.completedAt) return null;
  const elapsedMs =
    new Date(props.toolCall.completedAt).getTime() -
    new Date(props.toolCall.startedAt).getTime();
  if (elapsedMs < 1000) return `${elapsedMs}ms`;
  return `${(elapsedMs / 1000).toFixed(1)}s`;
});

function prettyPayload(payload: unknown): string {
  if (payload === null || payload === undefined) return "—";
  if (typeof payload === "string") return payload;
  return JSON.stringify(payload, null, 2);
}
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
      <span class="meta">
        <span v-if="durationLabel">{{ durationLabel }}</span>
        <span class="status-text">{{ statusLabel }}</span>
      </span>
    </button>

    <div v-if="isExpanded" class="detail">
      <p v-if="presentation.subtitle" class="subtitle">
        {{ presentation.subtitle }}
      </p>

      <CodeBlock
        v-if="presentation.body.kind === 'code'"
        :code="presentation.body.code"
        :language="presentation.body.language"
        :start-line="presentation.body.startLine"
        line-numbers
      />

      <div v-else-if="presentation.body.kind === 'diff'" class="diff">
        <div class="diff-pane is-removed">
          <p class="diff-label">Before</p>
          <CodeBlock
            :code="presentation.body.removed"
            :language="presentation.body.language"
          />
        </div>
        <div class="diff-pane is-added">
          <p class="diff-label">After</p>
          <CodeBlock
            :code="presentation.body.added"
            :language="presentation.body.language"
          />
        </div>
      </div>

      <div v-else-if="presentation.body.kind === 'terminal'" class="terminal">
        <p class="terminal-command">
          <span class="prompt">$</span> {{ presentation.body.command }}
        </p>
        <pre v-if="presentation.body.output" class="terminal-output">{{
          presentation.body.output
        }}</pre>
      </div>

      <pre v-else-if="presentation.body.kind === 'text'" class="text-output">{{
        presentation.body.text || "—"
      }}</pre>

      <div v-else class="payloads">
        <div class="payload">
          <p class="payload-label">Input</p>
          <pre class="payload-body">{{
            prettyPayload(presentation.body.input)
          }}</pre>
        </div>
        <div class="payload">
          <p class="payload-label">Output</p>
          <pre class="payload-body">{{
            prettyPayload(presentation.body.output)
          }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-call-card {
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  background: var(--bg-panel);
  overflow: hidden;
}

.summary {
  appearance: none;
  border: 0;
  margin: 0;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
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
}

.argument {
  color: var(--ink-1);
  font: 600 12px/1.5 var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.meta {
  margin-left: auto;
  display: flex;
  gap: 10px;
  flex: none;
  color: var(--ink-3);
  font: 400 11px/1.5 var(--font-ui);
}

.detail {
  display: grid;
  gap: 6px;
  padding: 0 10px 10px;
  border-top: 1px solid var(--hair);
  padding-top: 8px;
}

.subtitle {
  margin: 0;
  color: var(--ink-3);
  font: 400 11px/1.5 var(--font-mono);
  overflow-wrap: anywhere;
}

.diff {
  display: grid;
  gap: 6px;
}

.diff-pane.is-removed :deep(.code-block) {
  border-left: 3px solid var(--danger);
}

.diff-pane.is-added :deep(.code-block) {
  border-left: 3px solid var(--ok);
}

.diff-label {
  margin: 0 0 3px;
  color: var(--ink-3);
  font: 600 10px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.terminal {
  background: var(--bg-shell);
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  padding: 8px 10px;
}

.terminal-command {
  margin: 0;
  color: var(--ink-1);
  font: 500 12px/1.6 var(--font-mono);
  overflow-wrap: anywhere;
}

.prompt {
  color: var(--ink-3);
}

.terminal-output {
  margin: 4px 0 0;
  color: var(--ink-2);
  font: 400 11.5px/1.6 var(--font-mono);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 220px;
  overflow: auto;
}

.text-output {
  margin: 0;
  padding: 8px 10px;
  background: var(--bg-shell);
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  color: var(--ink-2);
  font: 400 11.5px/1.6 var(--font-mono);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 220px;
  overflow: auto;
}

.payloads {
  display: grid;
  gap: 6px;
}

@media (min-width: 720px) {
  .payloads {
    grid-template-columns: 1fr 1fr;
  }
}

.payload {
  background: var(--bg-shell);
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  padding: 8px 10px;
  min-width: 0;
}

.payload-label {
  margin: 0 0 4px;
  color: var(--ink-3);
  font: 600 10px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.payload-body {
  margin: 0;
  max-height: 220px;
  overflow: auto;
  color: var(--ink-2);
  font: 400 11.5px/1.55 var(--font-mono);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
