<script setup lang="ts">
import { computed } from "vue";
import { PhCircleNotch as CircleNotch, PhPlay as Play } from "@phosphor-icons/vue";
import type { WorkspaceEffectiveStatus } from "@vynel/contracts/workspaces/workspace-status";

// The ONE mark every tree row ends with — ALWAYS (Kafi, 2026-08-19): a
// spinner while working, a bold status dot when it needs you / hit a problem
// / completed, the play glyph when parked. One home for the workspace rows
// AND the pinned Global row (Kafi, 2026-08-26: Global drew only the spinner
// and the needs-input dot, so a parked or failed global area was the one row
// in the tree that ended with nothing).
const props = defineProps<{
  status: WorkspaceEffectiveStatus;
  /** Names the scope in the assistive label ("Acme is waiting on you"). */
  name: string;
}>();

const MARK_LABELS = {
  needs_input: "is waiting on you",
  problem: "hit a problem",
  completed: "is completed",
} as const;

const markStatus = computed<keyof typeof MARK_LABELS | null>(() =>
  props.status === "needs_input" ||
  props.status === "problem" ||
  props.status === "completed"
    ? props.status
    : null,
);
</script>

<template>
  <CircleNotch
    v-if="props.status === 'running'"
    :size="14"
    weight="bold"
    class="tree-state-running shrink-0 animate-spin text-gold"
    aria-label="Working"
  />
  <span
    v-else-if="markStatus"
    :aria-label="`${props.name} ${MARK_LABELS[markStatus]}`"
    class="tree-mark size-2.5 shrink-0 rounded-full"
    :data-status="markStatus"
  />
  <!-- Parked: the play mark — ALWAYS, open tasks or not (one rule: every
       row ends with its state; the count sits before it). -->
  <Play
    v-else
    :size="12"
    weight="fill"
    class="tree-state-parked shrink-0 text-[var(--color-neutral-500)]"
    aria-hidden="true"
    title="Pick up where it left off"
  />
</template>

<style scoped>
/* One status, one colour — the mark dot's hue is the state's, everywhere.
   A soft ring of the same hue makes it read from across the room. */
.tree-mark {
  box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 22%, transparent);
  animation: tree-mark-pulse 1.4s ease-in-out infinite;
}

.tree-mark[data-status="needs_input"] {
  background: var(--needs-input);
  color: var(--needs-input);
}

.tree-mark[data-status="problem"] {
  background: var(--danger);
  color: var(--danger);
}

.tree-mark[data-status="completed"] {
  background: var(--ok);
  color: var(--ok);
}

@keyframes tree-mark-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.45;
    transform: scale(0.8);
  }
}

@media (prefers-reduced-motion: reduce) {
  .tree-mark {
    animation: none;
  }
}
</style>
