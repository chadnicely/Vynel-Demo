<script setup lang="ts">
import { computed, ref } from "vue";
import type { ChatToolCallResponse } from "@vynel/contracts/chat/chat-http";
import {
  readBlockedToolOutput,
  reauthorizeToolCallMessage,
} from "@vynel/contracts/chat/blocked-tool-call";

// The refusal line under a blocked tool chip: the provider's own safety check
// stopped the call before it ran, so this says who refused it and why, and
// offers the single honest recovery — re-issue the intent. It only asks; the
// thread owner sends (props down, emits up).

/** What the host says about "Run it anyway": `ready` — the thread can send and
 *  nothing streams on it; `streaming` — wait for the current reply;
 *  `view-only` — this thread never sends (a library open, an earlier chain
 *  part), so the intent must be re-issued from the conversation's own chat. */
export type ReauthorizeState = "ready" | "streaming" | "view-only";

const props = defineProps<{
  toolCall: ChatToolCallResponse;
  /** Live only when `ready`; otherwise disabled, the title saying why. Absent =
   *  `streaming` — the button waits until the host says otherwise. */
  state?: ReauthorizeState | undefined;
}>();

const emit = defineEmits<{
  /** The host re-issues the intent as a normal message on the same session. */
  reauthorize: [];
}>();

// The reason comes from the refusal record the row carries, when the provider
// gave one.
const blockedReason = computed(
  () => readBlockedToolOutput(props.toolCall.toolOutput)?.reason ?? null,
);
const BLOCKED_NO_REASON = "It wasn't sure you meant this — run it anyway if you do.";

// The disabled button still explains itself — a view-only thread must not
// read as "wait", there is nothing to wait for there.
const REAUTHORIZE_LOCKED_TITLES: Record<Exclude<ReauthorizeState, "ready">, string> = {
  streaming: "Wait for the current reply to finish",
  "view-only": "This thread is view-only — run it from the conversation's own chat",
};
const state = computed<ReauthorizeState>(() => props.state ?? "streaming");
const canReauthorize = computed(() => state.value === "ready");
const reauthorizeTitle = computed(() =>
  state.value === "ready"
    ? `Send: ${reauthorizeToolCallMessage(props.toolCall.toolName)}`
    : REAUTHORIZE_LOCKED_TITLES[state.value],
);

// One click = one re-issued message; the button hides itself after (the
// thread shows the sent message, which IS the feedback). A fresh mount — a
// reload, the settled rows replacing the live card — may offer it again.
const hasReauthorized = ref(false);
function reauthorize() {
  if (!canReauthorize.value || hasReauthorized.value) return;
  hasReauthorized.value = true;
  emit("reauthorize");
}
</script>

<template>
  <div class="blocked-line" data-testid="tool-call-blocked">
    <span class="blocked-label">Blocked by Claude's safety check</span>
    <span class="blocked-reason">{{ blockedReason ?? BLOCKED_NO_REASON }}</span>
    <button
      v-if="!hasReauthorized"
      type="button"
      class="reauthorize-button"
      :disabled="!canReauthorize"
      :title="reauthorizeTitle"
      @click="reauthorize"
    >
      Run it anyway
    </button>
  </div>
</template>

<style scoped>
/* Reads like a Claude Code denial note: a quiet row under the chip, the danger
   hairline on the left, the action flush right. */
.blocked-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 5px 10px 6px;
  border-top: 1px solid var(--hair);
  box-shadow: inset 2px 0 0 var(--danger);
  font: 400 12px/1.5 var(--font-ui);
  color: var(--ink-2);
}

.blocked-label {
  color: var(--ink-1);
  font-weight: 600;
  flex: none;
}

.blocked-reason {
  min-width: 0;
  flex: 1 1 16ch;
}

.reauthorize-button {
  appearance: none;
  margin-left: auto;
  padding: 2px 10px;
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-s);
  background: var(--bg-panel);
  color: var(--ink-1);
  font: 600 11.5px/1.5 var(--font-ui);
  cursor: pointer;
  white-space: nowrap;
}

.reauthorize-button:hover:not(:disabled) {
  background: var(--row-hover);
}

.reauthorize-button:disabled {
  color: var(--ink-3);
  cursor: default;
}

.reauthorize-button:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: -2px;
}
</style>
