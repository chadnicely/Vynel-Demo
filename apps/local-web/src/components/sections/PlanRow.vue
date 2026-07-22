<script setup lang="ts">
import { computed } from "vue";
import { X } from "lucide-vue-next";
import type { PlanResponse, PlanStatus } from "@vynel/contracts/plans/plan-http";
import TaskStatusControl from "../tasks/TaskStatusControl.vue";
import { formatRelativeTime } from "../../utils/format-relative-time.js";

// One plan card (the TaskRow idiom). Plans deliberately share the tasks
// status vocabulary, so the status tile is the SAME control — one home for
// the open → in-progress → done cycle.
const props = defineProps<{
  plan: PlanResponse;
}>();

const emit = defineEmits<{
  "change-status": [status: PlanStatus];
  delete: [];
}>();

const isDone = computed(() => props.plan.status === "done");

// A done row trades its detail for when it finished — the day reads as a log.
const subtext = computed(() => {
  if (isDone.value)
    return props.plan.completedAt
      ? `Done ${formatRelativeTime(props.plan.completedAt)}`
      : "Done";
  return props.plan.detail;
});
</script>

<template>
  <div
    class="row group flex items-center gap-3 rounded-lg border border-hair bg-raised p-3 transition hover:border-hair-strong hover:shadow-raised"
    :class="{ 'opacity-70': isDone }"
  >
    <TaskStatusControl
      noun="plan"
      :status="props.plan.status"
      @change="emit('change-status', $event)"
    />
    <div class="row-main min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <p
          class="row-title m-0 truncate text-sm font-semibold"
          :class="isDone ? 'text-ink-3 line-through' : 'text-ink-1'"
        >
          {{ props.plan.title }}
        </p>
        <span
          class="source-chip inline-flex shrink-0 items-center rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
          >{{ props.plan.source === "assistant" ? "Claude" : "You" }}</span
        >
      </div>
      <p v-if="subtext" class="row-sub m-0 mt-0.5 truncate text-xs text-ink-3">
        {{ subtext }}
      </p>
    </div>
    <button
      type="button"
      class="delete-button shrink-0 cursor-default rounded-md p-1 text-ink-3 opacity-0 transition hover:bg-row-hover hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
      :title="`Delete ${props.plan.title}`"
      :aria-label="`Delete ${props.plan.title}`"
      @click="emit('delete')"
    >
      <X :size="14" />
    </button>
  </div>
</template>
