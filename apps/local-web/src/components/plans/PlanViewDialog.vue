<script setup lang="ts">
import { computed } from "vue";
import { CalendarRange } from "lucide-vue-next";
import { EmptyState, Modal } from "@vynel/ui";
import type { TaskResponse, TaskStatus } from "@vynel/contracts/tasks/task-http";
import type { PlanStatus } from "@vynel/contracts/plans/plan-http";
import { useUiStore } from "../../stores/ui-store.js";
import { usePlans } from "../../composables/plans/use-plans.js";
import { useUpdatePlan } from "../../composables/plans/use-update-plan.js";
import { useTasks } from "../../composables/tasks/use-tasks.js";
import { useUpdateTask } from "../../composables/tasks/use-update-task.js";
import { formatDayLabel } from "../../utils/format-day-label.js";
import TaskStatusControl from "../tasks/TaskStatusControl.vue";

// The SHARED plan review dialog — one instance, mounted by AppShell, keyed off
// `ui.viewingPlanId`. Opens from a chat `vynel://plan/<id>` link (Claude links
// plans for review), a plans-list View action, or a task's plan chip. Shows
// the plan plus its work items (tasks carrying its loose planId ref), both
// with live status cycling — review IS a working surface here.
const ui = useUiStore();

const isOpen = computed(() => ui.viewingPlanId !== null);

const plansQuery = usePlans(isOpen);
const tasksQuery = useTasks(isOpen);
const updatePlan = useUpdatePlan();
const updateTask = useUpdateTask();

const plan = computed(
  () =>
    (plansQuery.data.value ?? []).find(
      (row) => row.id === ui.viewingPlanId,
    ) ?? null,
);

const linkedTasks = computed(() =>
  (tasksQuery.data.value ?? []).filter(
    (row) => row.planId === ui.viewingPlanId,
  ),
);

const doneCount = computed(
  () => linkedTasks.value.filter((row) => row.status === "done").length,
);

function changePlanStatus(status: PlanStatus) {
  if (!plan.value) return;
  updatePlan.mutate({ planId: plan.value.id, status });
}

function changeTaskStatus(task: TaskResponse, status: TaskStatus) {
  updateTask.mutate({ taskId: task.id, status });
}

function onOpenChange(open: boolean) {
  if (!open) ui.viewingPlanId = null;
}
</script>

<template>
  <Modal :open="isOpen" size="lg" @update:open="onOpenChange">
    <template #title>
      <span class="flex items-center gap-2">
        <CalendarRange :size="18" class="shrink-0 text-ink-3" />
        {{ plan?.title ?? "Plan" }}
      </span>
    </template>

    <div v-if="plan" class="flex flex-col gap-4 pb-3 pt-1">
      <div class="flex flex-wrap items-center gap-2">
        <TaskStatusControl
          noun="plan"
          size="compact"
          :status="plan.status"
          @change="changePlanStatus"
        />
        <span class="text-sm font-semibold text-ink-1">{{
          formatDayLabel(plan.planDate)
        }}</span>
        <span class="text-xs text-ink-3">{{ plan.planDate }}</span>
        <span
          class="source-chip inline-flex shrink-0 items-center rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
          >{{ plan.source === "assistant" ? "Claude" : "You" }}</span
        >
      </div>

      <p
        v-if="plan.detail"
        class="plan-detail m-0 whitespace-pre-wrap rounded-lg border border-hair bg-panel p-3 text-sm text-ink-2"
      >
        {{ plan.detail }}
      </p>

      <section class="plan-tasks">
        <h3
          class="m-0 mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3"
        >
          Work items
          <span v-if="linkedTasks.length > 0"
            >· {{ doneCount }} / {{ linkedTasks.length }} done</span
          >
        </h3>
        <div v-if="linkedTasks.length > 0" class="flex flex-col gap-1.5">
          <div
            v-for="task in linkedTasks"
            :key="task.id"
            class="task-row flex items-center gap-2.5 rounded-md border border-hair bg-raised px-2.5 py-2"
          >
            <TaskStatusControl
              size="compact"
              :status="task.status"
              @change="changeTaskStatus(task, $event)"
            />
            <span
              class="min-w-0 flex-1 truncate text-[13px]"
              :class="
                task.status === 'done'
                  ? 'text-ink-3 line-through'
                  : 'text-ink-1'
              "
              >{{ task.title }}</span
            >
          </div>
        </div>
        <p v-else class="m-0 text-xs text-ink-3">
          No tasks are linked to this plan yet.
        </p>
      </section>
    </div>

    <!-- Only a SUCCESSFUL read proves absence — an errored read is not "deleted". -->
    <EmptyState
      v-else-if="plansQuery.isSuccess.value"
      title="Plan not found"
      hint="It may have been deleted, or the link is stale."
    />
    <EmptyState
      v-else-if="plansQuery.isError.value"
      title="Couldn't load the plan"
      hint="Check the app is connected, then try again."
    />
  </Modal>
</template>
