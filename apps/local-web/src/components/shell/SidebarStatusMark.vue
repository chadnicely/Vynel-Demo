<script setup lang="ts">
import { computed } from "vue";
import { PresenceDot } from "@vynel/ui";
import type { SessionStatusView } from "@vynel/contracts/chat/session-status";

// The status mark a menu row wears when a CONVERSATION lives behind it
// (today: Voice chat). Same vocabulary as the Sessions row and the tree row —
// one status, one colour — with the assistant's one-line why on the tooltip.
const props = defineProps<{
  status: SessionStatusView | null;
  /** Names the thread in the assistive label ("Voice chat hit a problem"). */
  label: string;
}>();

const MARK_LABELS = {
  needs_input: "is waiting on you",
  problem: "hit a problem",
  completed: "is completed",
} as const;

const markStatus = computed<keyof typeof MARK_LABELS | null>(() => {
  const current = props.status?.status;
  return current === "needs_input" ||
    current === "problem" ||
    current === "completed"
    ? current
    : null;
});
</script>

<template>
  <span
    v-if="props.status?.status === 'running'"
    class="inline-flex shrink-0 items-center"
    :aria-label="`${props.label} is working`"
  >
    <PresenceDot state="live" />
  </span>
  <span
    v-else-if="markStatus"
    class="sidebar-mark size-2 shrink-0 rounded-full"
    :data-status="markStatus"
    :title="props.status?.note ?? undefined"
    :aria-label="`${props.label} ${MARK_LABELS[markStatus]}`"
  />
</template>

<style scoped>
/* The tree row's and Sessions row's marks, tokens and pulse included, so the
   row reads the same as the conversation behind it. */
.sidebar-mark {
  animation: sidebar-mark-pulse 1.4s ease-in-out infinite;
}

.sidebar-mark[data-status="needs_input"] {
  background: var(--needs-input);
}

.sidebar-mark[data-status="problem"] {
  background: var(--danger);
}

.sidebar-mark[data-status="completed"] {
  background: var(--ok);
}

@keyframes sidebar-mark-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.35;
    transform: scale(0.72);
  }
}

@media (prefers-reduced-motion: reduce) {
  .sidebar-mark {
    animation: none;
  }
}
</style>
