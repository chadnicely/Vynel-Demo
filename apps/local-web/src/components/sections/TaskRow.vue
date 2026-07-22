<script setup lang="ts">
import { computed } from "vue";
import type { TaskResponse, TaskStatus } from "@vynel/contracts/tasks/task-http";
import TaskStatusControl from "../tasks/TaskStatusControl.vue";
import RowActions from "./RowActions.vue";
import { formatRelativeTime } from "../../utils/format-relative-time.js";

// One task card (ChannelsSection row idiom): the status tile cycles in place,
// the chip says who put it on the list, the fixed-width action cluster
// (View · Edit · Delete) reveals on hover.
const props = defineProps<{
  task: TaskResponse;
}>();

const emit = defineEmits<{
  "change-status": [status: TaskStatus];
  view: [];
  edit: [];
  delete: [];
}>();

const isDone = computed(() => props.task.status === "done");

// A done row trades its detail for when it finished — the archive reads as a log.
const subtext = computed(() => {
  if (isDone.value)
    return props.task.completedAt
      ? `Done ${formatRelativeTime(props.task.completedAt)}`
      : "Done";
  return props.task.detail;
});
</script>

<template>
  <div
    class="row group flex items-center gap-3 rounded-lg border border-hair bg-raised p-3 transition hover:border-hair-strong hover:shadow-raised"
    :class="{ 'opacity-70': isDone }"
  >
    <TaskStatusControl
      :status="props.task.status"
      @change="emit('change-status', $event)"
    />
    <div class="row-main min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <p
          class="row-title m-0 truncate text-sm font-semibold"
          :class="isDone ? 'text-ink-3 line-through' : 'text-ink-1'"
        >
          {{ props.task.title }}
        </p>
        <span
          class="source-chip inline-flex shrink-0 items-center rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
          >{{ props.task.source === "assistant" ? "Claude" : "You" }}</span
        >
      </div>
      <p v-if="subtext" class="row-sub m-0 mt-0.5 truncate text-xs text-ink-3">
        {{ subtext }}
      </p>
    </div>
    <RowActions
      :subject="props.task.title"
      @view="emit('view')"
      @edit="emit('edit')"
      @delete="emit('delete')"
    />
  </div>
</template>
