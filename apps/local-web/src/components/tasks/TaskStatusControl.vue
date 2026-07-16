<script setup lang="ts">
import { Check, Circle, CircleDotDashed } from "lucide-vue-next";
import type { TaskStatus } from "@vynel/contracts/tasks/task-http";

// The one home for the status cycle: every click walks open → in-progress →
// done → open, so a task is never stuck without a way back. Two sizes: the
// section rows wear it as their size-9 icon tile; the side panel compacts it.
const props = withDefaults(
  defineProps<{
    status: TaskStatus;
    size?: "tile" | "compact";
  }>(),
  { size: "tile" },
);

const emit = defineEmits<{
  change: [status: TaskStatus];
}>();

const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  open: "in-progress",
  "in-progress": "done",
  done: "open",
};

const ACTION_LABELS: Record<TaskStatus, string> = {
  open: "Start this task",
  "in-progress": "Mark this task done",
  done: "Reopen this task",
};

const STATUS_TINTS: Record<TaskStatus, string> = {
  open: "border border-hair bg-panel text-ink-3 hover:border-hair-strong hover:text-ink-1",
  "in-progress": "border border-info/40 bg-info/10 text-info hover:border-info",
  done: "border border-ok/40 bg-ok/10 text-ok hover:border-ok",
};
</script>

<template>
  <button
    type="button"
    class="status-control grid shrink-0 cursor-default place-items-center transition"
    :class="[
      STATUS_TINTS[props.status],
      props.size === 'tile' ? 'size-9 rounded-md' : 'size-5 rounded-full',
    ]"
    :title="ACTION_LABELS[props.status]"
    :aria-label="ACTION_LABELS[props.status]"
    @click="emit('change', NEXT_STATUS[props.status])"
  >
    <Check v-if="props.status === 'done'" :size="props.size === 'tile' ? 16 : 12" />
    <CircleDotDashed
      v-else-if="props.status === 'in-progress'"
      :size="props.size === 'tile' ? 16 : 12"
    />
    <Circle v-else :size="props.size === 'tile' ? 16 : 12" />
  </button>
</template>
