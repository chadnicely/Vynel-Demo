<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import {
  PhCalendarBlank as CalendarRange,
  PhChatCircle as ChatCircle,
  PhCheckCircle as CheckCircle,
  PhCircleDashed as CircleDashed,
  PhCircleHalf as CircleHalf,
} from "@phosphor-icons/vue";
import { Modal } from "@vynel/ui";
import type { TaskStatus } from "@vynel/contracts/tasks/task-http";
import { useTasks } from "../../composables/tasks/use-tasks.js";
import { useTaskSteps } from "../../composables/tasks/use-task-steps.js";
import { useSessionTodos } from "../../composables/todos/use-session-todos.js";
import { useUpdateTask } from "../../composables/tasks/use-update-task.js";
import { usePlanForTask } from "../../composables/plans/use-plan-for-task.js";
import { useUiStore } from "../../stores/ui-store.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import TaskStatusControl from "./TaskStatusControl.vue";

// View one task in full: title, status (live cycle), detail, provenance, its
// steps, a chip to the plan behind it, and the connected session. The steps
// are the task's OWN durable list (task-execution arc); tasks worked before
// that arc fall back to the creating session's dock so their history stays
// visible. The plan chip covers both relations: the task's `planId` (the
// day-plan link) and the execution plan whose `taskId` points here. Takes the
// ID and resolves the row from the live list query — a snapshot prop would
// freeze the status tile on its first transition (the PlanViewDialog
// precedent).
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

// The task's own steps first; the legacy session-dock read only fires when
// the task predates task steps (the steps query SETTLED empty — an in-flight
// read must not trigger a wasted dock fetch) AND has a creating session.
const taskStepsQuery = useTaskSteps(() => (props.open ? props.taskId : null));
const taskSteps = computed(() => taskStepsQuery.data.value ?? []);
const todosQuery = useSessionTodos(() =>
  props.open && taskStepsQuery.isFetched.value && taskSteps.value.length === 0
    ? (task.value?.sessionId ?? null)
    : null,
);
const steps = computed(() =>
  taskSteps.value.length > 0
    ? taskSteps.value
    : [...(todosQuery.data.value ?? [])].sort((a, b) => a.orderIndex - b.orderIndex),
);

// The execution plan whose loose `taskId` points at this task.
const { plan: executionPlan } = usePlanForTask(() =>
  props.open ? props.taskId : null,
);
const linkedPlanId = computed(
  () => task.value?.planId ?? executionPlan.value?.id ?? null,
);
const stepProgress = computed(() => {
  if (steps.value.length === 0) return null;
  const done = steps.value.filter((step) => step.status === "done").length;
  return {
    done,
    total: steps.value.length,
    pct: Math.round((100 * done) / steps.value.length),
  };
});

function changeStatus(status: TaskStatus) {
  if (!task.value) return;
  updateTask.mutate({ taskId: task.value.id, status });
}

function openPlan() {
  if (linkedPlanId.value === null) return;
  emit("close");
  ui.viewingPlanId = linkedPlanId.value;
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
          v-if="linkedPlanId"
          type="button"
          class="plan-chip inline-flex cursor-default items-center gap-1 rounded-full border border-hair px-2 py-0.5 text-[10.5px] font-semibold text-ink-2 transition hover:border-hair-strong hover:text-ink-1"
          aria-label="View the linked plan"
          @click="openPlan"
        >
          <CalendarRange :size="11" />
          View plan
        </button>
        <RouterLink
          v-if="task.assignedSessionId"
          class="inline-flex items-center gap-1 rounded-full border border-hair px-2 py-0.5 text-[10.5px] font-semibold text-ink-2 no-underline transition hover:border-hair-strong hover:text-ink-1"
          :to="
            task.workspaceId
              ? { path: '/sessions', query: { workspace: task.workspaceId } }
              : { path: '/sessions' }
          "
          aria-label="Open the sessions working this scope"
          @click="emit('close')"
        >
          <ChatCircle :size="11" />
          Connected session
        </RouterLink>
      </div>

      <p
        v-if="task.detail"
        class="task-detail m-0 whitespace-pre-wrap rounded-lg border border-hair bg-panel p-3 text-sm text-ink-2"
      >
        {{ task.detail }}
      </p>

      <!-- The steps — the session's real todos; nothing is fabricated for
           tasks that never ran. -->
      <div v-if="stepProgress" class="flex flex-col gap-2">
        <div class="flex items-center gap-2.5">
          <p class="m-0 text-2xs font-semibold uppercase tracking-wider text-ink-3">
            Steps
          </p>
          <span class="steps-bar h-[3px] min-w-0 flex-1 overflow-hidden rounded-full">
            <span
              class="steps-bar-fill block h-full rounded-full"
              :style="{ width: `${stepProgress.pct}%` }"
            />
          </span>
          <span class="text-2xs tabular-nums text-ink-3">
            {{ stepProgress.done }} of {{ stepProgress.total }}
          </span>
        </div>
        <ul class="m-0 flex list-none flex-col gap-1 p-0">
          <li
            v-for="step in steps"
            :key="step.id"
            class="flex items-center gap-2 text-sm"
            :class="step.status === 'done' ? 'text-ink-3' : 'text-ink-1'"
          >
            <CheckCircle
              v-if="step.status === 'done'"
              :size="14"
              class="shrink-0 text-gold"
            />
            <CircleHalf
              v-else-if="step.status === 'in-progress'"
              :size="14"
              class="shrink-0 text-gold-bright"
            />
            <CircleDashed v-else :size="14" class="shrink-0 text-ink-3" />
            <span class="min-w-0 flex-1 truncate">{{ step.title }}</span>
            <span
              v-if="step.completedAt"
              class="shrink-0 text-2xs text-ink-3"
              >{{ formatRelativeTime(step.completedAt) }}</span
            >
          </li>
        </ul>
      </div>

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

<style scoped>
.steps-bar {
  background: color-mix(in srgb, var(--ink-3) 25%, transparent);
}

.steps-bar-fill {
  background: var(--gold);
  transition: width var(--t-slow) var(--ease-out);
}
</style>
