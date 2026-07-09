<script setup lang="ts">
import { computed, ref } from "vue";
import type { ToolCallPresentation } from "../tool-cards/tool-presenters.js";
import CodeBlock from "./CodeBlock.vue";

// The expanded half of a tool card: the path header with copy, and the
// artifact itself — a unified +/- diff, file content, a terminal, or the
// payload panes. The chip half lives in ToolCallCard.
const props = defineProps<{
  presentation: ToolCallPresentation;
}>();

function prettyPayload(payload: unknown): string {
  if (payload === null || payload === undefined) return "—";
  if (typeof payload === "string") return payload;
  return JSON.stringify(payload, null, 2);
}

// Copy the primary artifact — the content a person would actually reuse.
const copyText = computed(() => {
  const body = props.presentation.body;
  if (body.kind === "code") return body.code;
  if (body.kind === "diff") return body.added || body.removed;
  if (body.kind === "terminal") return body.command;
  if (body.kind === "text") return body.text;
  return prettyPayload(body.output ?? body.input);
});

const hasCopied = ref(false);
let copiedResetTimer: ReturnType<typeof setTimeout> | null = null;

async function copyPrimary() {
  try {
    await navigator.clipboard.writeText(copyText.value);
    hasCopied.value = true;
    if (copiedResetTimer !== null) clearTimeout(copiedResetTimer);
    copiedResetTimer = setTimeout(() => (hasCopied.value = false), 1500);
  } catch {
    // Clipboard access denied (permissions/insecure context) — the button
    // simply doesn't confirm; nothing else to recover.
  }
}
</script>

<template>
  <div class="detail">
    <div v-if="props.presentation.subtitle" class="file-header">
      <span class="file-path">{{ props.presentation.subtitle }}</span>
      <button
        type="button"
        class="copy-button"
        :aria-label="hasCopied ? 'Copied' : 'Copy contents'"
        :title="hasCopied ? 'Copied' : 'Copy'"
        @click="copyPrimary"
      >
        <svg
          v-if="!hasCopied"
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <rect
            x="5.5"
            y="5.5"
            width="8"
            height="8"
            rx="1.5"
            stroke="currentColor"
            stroke-width="1.4"
          />
          <path
            d="M10.5 3.5v-1a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1"
            stroke="currentColor"
            stroke-width="1.4"
          />
        </svg>
        <svg
          v-else
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3 8.5l3.5 3.5L13 5"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>

    <CodeBlock
      v-if="props.presentation.body.kind === 'code'"
      :code="props.presentation.body.code"
      :language="props.presentation.body.language"
      :start-line="props.presentation.body.startLine"
      line-numbers
    />

    <!-- Unified diff: the removed block (red, "-" gutter) flows straight into
         the added block (green, "+" gutter) — one artifact, not Before/After
         panes. -->
    <div v-else-if="props.presentation.body.kind === 'diff'" class="diff">
      <div v-if="props.presentation.body.removed" class="diff-block is-removed">
        <CodeBlock
          :code="props.presentation.body.removed"
          :language="props.presentation.body.language"
        />
      </div>
      <div v-if="props.presentation.body.added" class="diff-block is-added">
        <CodeBlock
          :code="props.presentation.body.added"
          :language="props.presentation.body.language"
        />
      </div>
    </div>

    <div
      v-else-if="props.presentation.body.kind === 'terminal'"
      class="terminal"
    >
      <p class="terminal-command">
        <span class="prompt">$</span> {{ props.presentation.body.command }}
      </p>
      <pre v-if="props.presentation.body.output" class="terminal-output">{{
        props.presentation.body.output
      }}</pre>
    </div>

    <pre
      v-else-if="props.presentation.body.kind === 'text'"
      class="text-output"
      >{{ props.presentation.body.text || "—" }}</pre
    >

    <div v-else class="payloads">
      <div class="payload">
        <p class="payload-label">Input</p>
        <pre class="payload-body">{{
          prettyPayload(props.presentation.body.input)
        }}</pre>
      </div>
      <div class="payload">
        <p class="payload-label">Result</p>
        <pre class="payload-body">{{
          prettyPayload(props.presentation.body.output)
        }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.detail {
  display: grid;
  gap: 6px;
  padding: 8px 10px 10px;
  border-top: 1px solid var(--hair);
}

.file-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  background: var(--bg-shell);
}

.file-path {
  color: var(--ink-2);
  font: 400 11px/1.5 var(--font-mono);
  overflow-wrap: anywhere;
  min-width: 0;
}

.copy-button {
  appearance: none;
  border: 0;
  margin-left: auto;
  padding: 3px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-s);
  background: transparent;
  color: var(--ink-3);
  cursor: default;
  flex: none;
}

.copy-button:hover {
  color: var(--ink-1);
  background: var(--row-hover);
}

.copy-button:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: -1px;
}

.diff {
  display: grid;
}

.diff-block :deep(.code-block) {
  max-height: 420px;
  border-left-width: 3px;
}

.diff-block.is-removed :deep(.code-block) {
  border-left-color: var(--danger);
  background: color-mix(in srgb, var(--danger) 6%, var(--bg-shell));
}

.diff-block.is-added :deep(.code-block) {
  border-left-color: var(--ok);
  background: color-mix(in srgb, var(--ok) 6%, var(--bg-shell));
}

/* The +/- gutter, per line. Diff blocks never use CodeBlock's line numbers,
   so this ::before slot is free. */
.diff-block :deep(.line)::before {
  display: inline-block;
  width: 1.4em;
  user-select: none;
}

.diff-block.is-removed :deep(.line)::before {
  content: "-";
  color: var(--danger);
}

.diff-block.is-added :deep(.line)::before {
  content: "+";
  color: var(--ok);
}

/* Two touching blocks read as one artifact: square the shared edge. */
.diff-block:has(+ .diff-block) :deep(.code-block) {
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
  border-bottom: 0;
}

.diff-block + .diff-block :deep(.code-block) {
  border-top-left-radius: 0;
  border-top-right-radius: 0;
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
