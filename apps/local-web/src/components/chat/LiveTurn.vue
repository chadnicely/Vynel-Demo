<script setup lang="ts">
import {
  ApprovalCard,
  ThinkingBlock,
  ToolCallList,
  MarkdownText,
} from "@vynel/ui";
import type { ActiveTurnView } from "../../composables/chat/active-turn-view.js";

// The in-flight turn: everything the assistant is doing RIGHT NOW —
// thinking, answer text typing in, tool cards appearing, approvals pausing
// the stream. The gold cursor marks the live edge.
const props = defineProps<{ view: ActiveTurnView }>();

const emit = defineEmits<{
  decideApproval: [approvalRequestId: string, decision: "approved" | "denied"];
}>();
</script>

<template>
  <div class="live-turn">
    <p class="role-label">
      Assistant
      <span v-if="props.view.status === 'streaming'" class="live-chip"
        >working</span
      >
    </p>

    <ThinkingBlock
      v-if="props.view.thinking"
      :text="props.view.thinking"
      :streaming="props.view.isThinkingLive"
    />

    <div v-if="props.view.text" class="answer">
      <MarkdownText :source="props.view.text" />
      <span
        v-if="props.view.status === 'streaming'"
        class="stream-cursor"
        aria-hidden="true"
      />
    </div>

    <ToolCallList
      v-if="props.view.toolCalls.length > 0"
      :tool-calls="props.view.toolCalls"
    />

    <template
      v-for="approval in props.view.approvals"
      :key="approval.approvalRequestId"
    >
      <!-- No actionKind on the approval-requested event yet (contract gap,
           noted for Slice-3) — the card's generic headline stays honest. -->
      <ApprovalCard
        v-if="!approval.isResolved"
        :tool-name="approval.toolName"
        :tool-input="approval.toolInput"
        @approve="
          emit('decideApproval', approval.approvalRequestId, 'approved')
        "
        @deny="emit('decideApproval', approval.approvalRequestId, 'denied')"
      />
    </template>

    <p v-if="props.view.status === 'interrupted'" class="status-note">
      Stopped — the task was interrupted.
    </p>
    <p v-else-if="props.view.error" class="status-note is-error">
      {{ props.view.error.message }}
    </p>
  </div>
</template>

<style scoped>
.live-turn {
  display: grid;
  gap: 8px;
}

.role-label {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ink-3);
  font: 600 10.5px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.07em;
}

.live-chip {
  color: var(--gold);
  font: 600 10px/1.4 var(--font-ui);
  letter-spacing: 0.05em;
  padding: 1px 7px;
  border: 1px solid var(--gold-soft);
  border-radius: 99px;
  background: var(--gold-soft);
  animation: live-chip-breathe 1.6s var(--ease-out) infinite;
}

@keyframes live-chip-breathe {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}

@media (prefers-reduced-motion: reduce) {
  .live-chip {
    animation: none;
  }
}

.answer {
  position: relative;
}

.stream-cursor {
  display: inline-block;
  width: 7px;
  height: 14px;
  margin-left: 3px;
  vertical-align: -2px;
  background: var(--gold);
  border-radius: 2px;
  animation: cursor-blink 1s steps(2, jump-none) infinite;
}

@keyframes cursor-blink {
  50% {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .stream-cursor {
    animation: none;
  }
}

.status-note {
  margin: 0;
  color: var(--ink-3);
  font: 400 12px/1.5 var(--font-ui);
}

.status-note.is-error {
  color: var(--danger);
}
</style>
