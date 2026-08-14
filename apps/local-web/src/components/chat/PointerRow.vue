<script setup lang="ts">
import { computed } from "vue";
import {
  PhArrowSquareOut as ArrowSquareOut,
  PhCheckCircle as CheckCircle,
  PhCircleNotch as CircleNotch,
  PhGitFork as GitFork,
  PhWarningCircle as WarningCircle,
} from "@phosphor-icons/vue";
import type { ThreadPointerModel } from "./thread-pointers.js";

// The pointer IS the tracker (live-tracking redesign, Case 1): no mirrored
// narration — the task, where it went, and how it is doing; click navigates to
// the real conversation. It PERSISTS (Chad, 2026-08-09): a settled task keeps
// its pointer in a done/failed state, so the door into where the work happened
// stays in the history.
//
// It wears the canvas's HANDED OFF card (`Vynel Workspace.dc.html` — dashed
// tinted panel, kind icon + eyebrow, the line, then the target pill), one step
// smaller (Kafi, 2026-08-15). The canvas draws only the live case, so the TONE
// carries the status: gold while it runs — presence, the one rule — and never
// gold once it has settled.
const props = defineProps<{ pointer: ThreadPointerModel }>();

const emit = defineEmits<{ open: [] }>();

const STATES = {
  queued: { label: "Queued", tone: "var(--ink-3)", icon: CircleNotch },
  working: { label: "Working", tone: "var(--gold)", icon: CircleNotch },
  completed: { label: "Done", tone: "var(--ok)", icon: CheckCircle },
  failed: { label: "Failed", tone: "var(--danger)", icon: WarningCircle },
} as const;

const state = computed(() => STATES[props.pointer.status]);
</script>

<template>
  <button
    type="button"
    class="pointer-card"
    :style="{ '--tone': state.tone }"
    :data-status="props.pointer.status"
    data-testid="thread-pointer"
    @click="emit('open')"
  >
    <span class="pointer-eyebrow">
      <GitFork :size="12" class="kind-icon" aria-hidden="true" />
      <span class="pointer-state">{{ state.label }}</span>
      <ArrowSquareOut :size="11" class="open-icon" aria-hidden="true" />
    </span>
    <span class="pointer-task">{{ props.pointer.taskLabel }}</span>
    <span class="pointer-target-row">
      <span class="pointer-target">
        <component
          :is="state.icon"
          :size="9"
          class="target-icon"
          :class="{ 'is-spinning': props.pointer.status === 'working' }"
          aria-hidden="true"
        />
        {{ props.pointer.targetLabel }}
      </span>
    </span>
  </button>
</template>

<style scoped>
.pointer-card {
  /* The status binds --tone inline. Declaring a default matters: an unset
     custom property makes every color-mix() below invalid at once, and the
     card loses its whole treatment rather than degrading. */
  --tone: var(--ink-3);
  appearance: none;
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin: 2px 0 8px;
  padding: 9px 12px;
  width: 100%;
  min-width: 0;
  text-align: left;
  border: 1px dashed color-mix(in srgb, var(--tone) 45%, transparent);
  border-radius: var(--radius-m);
  background: color-mix(in srgb, var(--tone) 7%, var(--color-bg));
  cursor: pointer;
  transition: border-color 120ms ease;
}

.pointer-card:hover {
  border-color: color-mix(in srgb, var(--tone) 70%, transparent);
}

.pointer-card:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
}

.pointer-eyebrow {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.kind-icon {
  flex: none;
  color: var(--tone);
}

.pointer-state {
  color: var(--tone);
  font: 400 9px/1.4 var(--font-ui);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

/* The door into the target conversation — the whole card carries the click,
   this names it. */
.open-icon {
  flex: none;
  margin-left: auto;
  color: var(--ink-3);
}

.pointer-card:hover .open-icon {
  color: var(--tone);
}

.pointer-task {
  color: var(--ink-1);
  font: 400 12px/1.45 var(--font-ui);
  text-wrap: pretty;
  overflow-wrap: break-word;
}

.pointer-target-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.pointer-target {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 2px 9px 2px 7px;
  border: 1px solid color-mix(in srgb, var(--tone) 38%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--tone) 14%, transparent);
  color: var(--tone);
  font: 500 10.5px/1.5 var(--font-ui);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.target-icon {
  flex: none;
}

.target-icon.is-spinning {
  animation: pointer-spin 1.1s linear infinite;
}

@keyframes pointer-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .target-icon.is-spinning {
    animation: none;
  }
}
</style>
