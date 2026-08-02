<script setup lang="ts">
import { computed, ref } from "vue";
import { ChevronRight, ListChecks, Plus } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import type { TaskResponse, TaskStatus } from "@vynel/contracts/tasks/task-http";
import { useTasks } from "../../composables/tasks/use-tasks.js";
import { useCreateTask } from "../../composables/tasks/use-create-task.js";
import { useUpdateTask } from "../../composables/tasks/use-update-task.js";
import { useDeleteTask } from "../../composables/tasks/use-delete-task.js";
import TaskViewDialog from "../tasks/TaskViewDialog.vue";
import EditTaskDialog from "../tasks/EditTaskDialog.vue";
import SectionHeader from "./SectionHeader.vue";
import TaskRow from "./TaskRow.vue";
import type { SectionScope } from "./section-scope.js";

// The tasks section, on either surface: what Claude is on the hook for. The
// composer adds inline (no dialog — a task is one line), the open list leads,
// finished work collapses into the Done archive.
const props = defineProps<{
  scope: SectionScope;
}>();

const tasksQuery = useTasks(true);
const createTask = useCreateTask();
const updateTask = useUpdateTask();
const deleteTask = useDeleteTask();

const tasks = computed(() => {
  const rows = tasksQuery.data.value ?? [];
  if (props.scope.kind === "global")
    return rows.filter((row) => row.workspaceId === null);
  const workspaceId = props.scope.workspaceId;
  return rows.filter(
    (row) => row.workspaceId === null || row.workspaceId === workspaceId,
  );
});

const openTasks = computed(() =>
  tasks.value.filter((row) => row.status !== "done"),
);
const doneTasks = computed(() =>
  tasks.value.filter((row) => row.status === "done"),
);

const newTaskTitle = ref("");

function addTask() {
  const title = newTaskTitle.value.trim();
  if (title.length === 0 || createTask.isPending.value) return;
  createTask.mutate(
    props.scope.kind === "workspace"
      ? { scope: "workspace", workspaceId: props.scope.workspaceId, title }
      : { scope: "global", title },
    { onSuccess: () => (newTaskTitle.value = "") },
  );
}

function changeStatus(task: TaskResponse, status: TaskStatus) {
  updateTask.mutate({ taskId: task.id, status });
}

function removeTask(task: TaskResponse) {
  deleteTask.mutate({ taskId: task.id });
}

const isDoneOpen = ref(false);

// View/Edit open over the ROW the action came from; the list stays put.
// View holds the ID (the dialog resolves the live row itself); Edit holds
// the snapshot deliberately — an edit form starts from the clicked state.
const viewingTaskId = ref<string | null>(null);
const editingTask = ref<TaskResponse | null>(null);
</script>

<template>
  <div class="tasks-section flex flex-col gap-2.5">
    <SectionHeader
      :icon="ListChecks"
      title="Tasks"
      subtitle="The running list Claude works through and checks off"
    />

    <form
      class="composer flex items-center gap-2 rounded-lg border border-hair bg-raised py-1.5 pl-3 pr-1.5 transition focus-within:border-hair-strong"
      @submit.prevent="addTask"
    >
      <Plus :size="15" class="shrink-0 text-ink-3" />
      <input
        v-model="newTaskTitle"
        type="text"
        placeholder="Add a task…"
        aria-label="New task title"
        class="min-w-0 flex-1 border-0 bg-transparent text-sm text-ink-1 outline-none placeholder:text-ink-3"
      />
      <button
        type="submit"
        class="add-button inline-flex shrink-0 cursor-default items-center rounded-full border border-hair px-[11px] py-[3px] text-xs font-semibold text-ink-2 transition enabled:hover:border-hair-strong enabled:hover:bg-row-hover enabled:hover:text-ink-1 disabled:opacity-50"
        :disabled="newTaskTitle.trim().length === 0"
      >
        Add
      </button>
    </form>

    <div v-if="openTasks.length > 0" class="rows flex flex-col gap-2">
      <TaskRow
        v-for="task in openTasks"
        :key="task.id"
        :task="task"
        @change-status="changeStatus(task, $event)"
        @view="viewingTaskId = task.id"
        @edit="editingTask = task"
        @delete="removeTask(task)"
      />
    </div>

    <EmptyState
      v-else
      title="Nothing on the list"
      hint="Ask Claude for something and it'll track the steps here — or add one above."
    >
      <template #icon>
        <ListChecks :size="22" />
      </template>
    </EmptyState>

    <div v-if="doneTasks.length > 0" class="done-group">
      <button
        type="button"
        class="done-toggle inline-flex cursor-default items-center gap-1 rounded-md px-1 py-0.5 text-xs font-semibold text-ink-3 transition hover:text-ink-1"
        :aria-expanded="isDoneOpen"
        @click="isDoneOpen = !isDoneOpen"
      >
        <ChevronRight
          :size="13"
          class="transition-transform"
          :class="{ 'rotate-90': isDoneOpen }"
        />
        Done · {{ doneTasks.length }}
      </button>
      <div v-if="isDoneOpen" class="done-rows mt-2 flex flex-col gap-2">
        <TaskRow
          v-for="task in doneTasks"
          :key="task.id"
          :task="task"
          @change-status="changeStatus(task, $event)"
          @view="viewingTaskId = task.id"
          @edit="editingTask = task"
          @delete="removeTask(task)"
        />
      </div>
    </div>

    <TaskViewDialog
      :open="viewingTaskId !== null"
      :task-id="viewingTaskId"
      @close="viewingTaskId = null"
    />
    <EditTaskDialog
      :open="editingTask !== null"
      :task="editingTask"
      @close="editingTask = null"
    />
  </div>
</template>
