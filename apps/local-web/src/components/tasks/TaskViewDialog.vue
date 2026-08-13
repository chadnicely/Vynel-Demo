<script setup lang="ts">
import { computed } from "vue";
import { PhCalendarBlank as CalendarRange } from "@phosphor-icons/vue";
import { Modal } from "@vynel/ui";
import type { TaskStatus } from "@vynel/contracts/tasks/task-http";
import { useTasks } from "../../composables/tasks/use-tasks.js";
import { useUpdateTask } from "../../composables/tasks/use-update-task.js";
import { useUiStore } from "../../stores/ui-store.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import TaskStatusControl from "./TaskStatusControl.vue";

// View one task in full: title, status (live cycle), detail, provenance, and
// — when it belongs to a plan — a chip that opens the SHARED plan review
// dialog (the task→plan deep link). Takes the ID and resolves the row from
// the live list query — a snapshot prop would freeze the status tile on its
// first transition (the PlanViewDialog precedent).
const props = defineProps<{
  open: boolean;
  taskId: string | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const ui = useUiStore();
const tasksQuery = useTasks(computed(() => props.open));
const updateTask = useUpdateTask();

const task = computed(
  () =>
    (tasksQuery.data.value ?? []).find((row) => row.id === props.taskId) ??
    null,
);

function changeStatus(status: TaskStatus) {
  if (!task.value) return;
  updateTask.mutate({ taskId: task.value.id, status });
}

function openPlan() {
  if (!task.value?.planId) return;
  emit("close");
  ui.viewingPlanId = task.value.planId;
}

function onOpenChange(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <Modal
    :open="props.open"
    :title="task?.title ?? 'Task'"
    @update:open="onOpenChange"
  >
    <div v-if="task" class="flex flex-col gap-3.5 pb-3 pt-1">
      <div class="flex flex-wrap items-center gap-2">
        <TaskStatusControl
          size="compact"
          :status="task.status"
          @change="changeStatus"
        />
        <span class="text-xs capitalize text-ink-2">{{ task.status }}</span>
        <span
          class="source-chip inline-flex shrink-0 items-center rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
          >{{ task.source === "assistant" ? "Claude" : "You" }}</span
        >
        <button
          v-if="task.planId"
          type="button"
          class="plan-chip inline-flex cursor-default items-center gap-1 rounded-full border border-hair px-2 py-0.5 text-[10.5px] font-semibold text-ink-2 transition hover:border-hair-strong hover:text-ink-1"
          aria-label="View the linked plan"
          @click="openPlan"
        >
          <CalendarRange :size="11" />
          View plan
        </button>
      </div>

      <p
        v-if="task.detail"
        class="task-detail m-0 whitespace-pre-wrap rounded-lg border border-hair bg-panel p-3 text-sm text-ink-2"
      >
        {{ task.detail }}
      </p>

      <p class="m-0 text-xs text-ink-3">
        Added {{ formatRelativeTime(task.createdAt) }}<template
          v-if="task.completedAt"
        >
          · done {{ formatRelativeTime(task.completedAt) }}</template
        >
      </p>
    </div>
  </Modal>
</template>
