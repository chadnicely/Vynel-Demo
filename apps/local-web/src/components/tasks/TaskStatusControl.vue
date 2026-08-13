<script setup lang="ts">
import { computed } from "vue";
import {
  PhCheck as Check,
  PhCircle as Circle,
  PhCircleDashed as CircleDotDashed,
} from "@phosphor-icons/vue";
import type { TaskStatus } from "@vynel/contracts/tasks/task-http";

// The one home for the status cycle: every click walks open → in-progress →
// done → open, so a row is never stuck without a way back. Two sizes: the
// section rows wear it as their size-9 icon tile; the side panel compacts it.
// Plans share the same status vocabulary, so PlanRow wears this control too —
// `noun` keeps the accessible labels honest about what is cycling.
const props = withDefaults(
  defineProps<{
    status: TaskStatus;
    size?: "tile" | "compact";
    noun?: "task" | "plan";
  }>(),
  { size: "tile", noun: "task" },
);

const emit = defineEmits<{
  change: [status: TaskStatus];
}>();

const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  open: "in-progress",
  "in-progress": "done",
  done: "open",
};

const actionLabel = computed(() => {
  const labels: Record<TaskStatus, string> = {
    open: `Start this ${props.noun}`,
    "in-progress": `Mark this ${props.noun} done`,
    done: `Reopen this ${props.noun}`,
  };
  return labels[props.status];
});

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
    :title="actionLabel"
    :aria-label="actionLabel"
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
