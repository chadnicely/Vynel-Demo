<script setup lang="ts">
import type { ThreadPointerModel } from "./thread-pointers.js";

// The pointer IS the tracker (live-tracking redesign, Case 1): no card, no
// mirrored narration — a quiet "task → target" line; click navigates to the
// real conversation. It PERSISTS (Chad, 2026-08-09): the gold dot breathes
// while working, and a settled task keeps the line in a done/failed state —
// the door into where the work happened stays in the history.
const props = defineProps<{ pointer: ThreadPointerModel }>();

const emit = defineEmits<{ open: [] }>();
</script>

<template>
  <button
    type="button"
    class="pointer-row"
    :data-status="props.pointer.status"
    data-testid="thread-pointer"
    @click="emit('open')"
  >
    <span aria-hidden="true" class="pointer-glyph">↳</span>
    <span class="pointer-task">{{ props.pointer.taskLabel }}</span>
    <span aria-hidden="true" class="pointer-glyph">→</span>
    <span class="pointer-target">{{ props.pointer.targetLabel }}</span>
    <span v-if="props.pointer.status === 'queued'" class="pointer-state">queued</span>
    <span v-else-if="props.pointer.status === 'completed'" class="pointer-state">done</span>
    <span v-else-if="props.pointer.status === 'failed'" class="pointer-state pointer-failed"
      >failed</span
    >
    <span v-else class="pointer-live" role="img" aria-label="working" />
  </button>
</template>

<style scoped>
.pointer-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 2px 0 8px;
  padding: 3px 10px;
  max-width: 100%;
  border: 1px solid var(--hair);
  border-radius: 999px;
  background: transparent;
  font-size: 11.5px;
  color: var(--ink-3);
  cursor: pointer;
  transition:
    color 120ms ease,
    border-color 120ms ease;
}
.pointer-row:hover {
  color: var(--ink-1);
  border-color: var(--hair-strong, var(--hair));
}
.pointer-glyph {
  opacity: 0.7;
}
.pointer-task,
.pointer-target {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pointer-target {
  color: var(--ink-2);
}
.pointer-state {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.8;
}
/* Honest terminal state — never gold (gold = presence only). */
.pointer-failed {
  color: var(--danger);
}
/* Gold = presence (the one rule): the dot breathes only while working. */
.pointer-live {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--gold);
  animation: pointer-breathe 1.6s ease-in-out infinite;
}
@keyframes pointer-breathe {
  0%,
  100% {
    opacity: 0.5;
  }
  50% {
    opacity: 1;
  }
}
</style>
