<script setup lang="ts">
import { computed } from "vue";
import { useTaskSteps } from "../../composables/tasks/use-task-steps.js";
import { currentStepOf } from "./current-step.js";

// The sub-line under an in-progress task's collapsed row (Kafi's sketch,
// 2026-08-18): the step being worked right now, breathing like the chat's
// working pill, so the queue answers "what is happening" without expanding.
// EVERY in-progress task wears one (Kafi, 2026-08-22), so each line owns its
// steps query — bounded by the number of tasks actually in progress, and
// vue-query dedupes it with the expander's fetch of the same task.
const props = defineProps<{
  taskId: string;
  /** The list's own n/m rollup — shown on the line, not the row. */
  countLabel: string | null;
}>();

const stepsQuery = useTaskSteps(() => props.taskId);
const currentStep = computed(() => currentStepOf(stepsQuery.data.value ?? []));
</script>

<template>
  <!-- Always a line: while the steps load, or once every step is done but
       the task still runs, it says "now" with the count — the row never goes
       blank for a task that is in progress. -->
  <div class="live-step-line" data-testid="live-step-line">
    <span class="live-step-dot" aria-hidden="true" />
    <span v-if="currentStep" class="live-step-title" :title="currentStep.title">
      {{ currentStep.number }}. {{ currentStep.title }}
    </span>
    <span v-else class="live-step-title">now</span>
    <span v-if="props.countLabel" class="live-step-count">{{ props.countLabel }}</span>
  </div>
</template>

<style scoped>
.live-step-line {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 2px 13px;
  padding: 3px 8px 5px 13px;
  border-left: 1px solid color-mix(in srgb, var(--gold) 45%, transparent);
  min-width: 0;
}

.live-step-dot {
  flex: none;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--gold);
  box-shadow: 0 0 7px color-mix(in srgb, var(--gold) 60%, transparent);
  animation: live-step-pulse 1.4s ease-in-out infinite;
}

.live-step-title {
  min-width: 0;
  flex: 1;
  color: var(--gold-bright);
  font: 400 11.5px/1.5 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.live-step-count {
  flex: none;
  color: var(--ink-3);
  font: 400 10px/1.5 var(--font-ui);
  font-variant-numeric: tabular-nums;
}

@keyframes live-step-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}

@media (prefers-reduced-motion: reduce) {
  .live-step-dot {
    animation: none;
  }
}
</style>
