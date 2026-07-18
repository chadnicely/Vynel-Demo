<script setup lang="ts">
import { computed } from "vue";
import {
  ApprovalCard,
  ThinkingBlock,
  ToolCallList,
  MarkdownText,
} from "@vynel/ui";
// The pure taxonomy the server itself records with — same function, so the
// inline card and the notifier card always classify identically.
import { deriveActionKind } from "@vynel/approvals/action-kind";
import type { ActiveTurnView } from "../../composables/chat/active-turn-view.js";

// The in-flight turn: everything the assistant is doing RIGHT NOW —
// thinking, answer text typing in, tool cards appearing, approvals pausing
// the stream. The gold cursor marks the live edge.
const props = withDefaults(
  defineProps<{
    view: ActiveTurnView;
    /** Who is streaming — matches MessageRow's settled label for the surface. */
    authorLabel?: string;
  }>(),
  { authorLabel: "Assistant" },
);

const emit = defineEmits<{
  decideApproval: [approvalRequestId: string, decision: "approved" | "denied"];
}>();

// The live edge — only the LAST segment is still being written, so only it
// wears the cursor and a live thinking shimmer. Earlier segments are done and
// render exactly like their settled MessageRow will.
const lastSegmentId = computed(
  () => props.view.segments.at(-1)?.messageId ?? null,
);
</script>

<template>
  <div class="live-turn">
    <p class="role-label">
      {{ props.authorLabel }}
      <span v-if="props.view.status === 'streaming'" class="live-chip"
        >working</span
      >
    </p>

    <!-- One block per assistant message, in arrival order — the SAME
         thinking → text → tool-calls shape MessageRow gives the settled row,
         so the thread never reformats when the turn completes. -->
    <div
      v-for="segment in props.view.segments"
      :key="segment.messageId"
      class="segment"
    >
      <ThinkingBlock
        v-if="segment.thinking"
        :text="segment.thinking"
        :streaming="
          props.view.isThinkingLive && segment.messageId === lastSegmentId
        "
      />

      <div v-if="segment.text" class="answer">
        <MarkdownText :source="segment.text" />
        <span
          v-if="
            props.view.status === 'streaming' &&
            segment.messageId === lastSegmentId
          "
          class="stream-cursor"
          aria-hidden="true"
        />
      </div>

      <ToolCallList
        v-if="segment.toolCalls.length > 0"
        :tool-calls="segment.toolCalls"
      />
    </div>

    <template
      v-for="approval in props.view.approvals"
      :key="approval.approvalRequestId"
    >
      <ApprovalCard
        v-if="!approval.isResolved"
        :tool-name="approval.toolName"
        :tool-input="approval.toolInput"
        :action-kind="deriveActionKind(approval.toolName)"
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

.segment {
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
