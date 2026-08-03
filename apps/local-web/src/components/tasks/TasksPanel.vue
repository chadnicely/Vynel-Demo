<script setup lang="ts">
import { computed } from "vue";
import { EmptyState } from "@vynel/ui";
import type { TaskResponse, TaskStatus } from "@vynel/contracts/tasks/task-http";
import { useTasksInScope } from "../../composables/tasks/use-tasks-in-scope.js";
import { useUpdateTask } from "../../composables/tasks/use-update-task.js";
import type { SectionScope } from "../sections/section-scope.js";
import TaskStatusControl from "./TaskStatusControl.vue";

// The opt-in tasks dock: a compact glance at what's still open, beside
// whichever chat surface is up. It reads the same scoped query as
// TasksSection, so the dock and the menu never disagree.
const props = defineProps<{
  scope: SectionScope;
}>();

const tasksQuery = useTasksInScope(() => props.scope);
const updateTask = useUpdateTask();

const tasksInScope = computed(() => tasksQuery.data.value ?? []);

const openTasks = computed(() =>
  tasksInScope.value.filter((row) => row.status !== "done"),
);

function changeStatus(task: TaskResponse, status: TaskStatus) {
  updateTask.mutate({ taskId: task.id, status });
}
</script>

<template>
  <aside class="tasks-panel">
    <header class="panel-header">
      <p class="panel-title">Tasks</p>
      <span class="count-chip">{{ openTasks.length }} open</span>
    </header>

    <div class="task-list">
      <EmptyState
        v-if="openTasks.length === 0"
        title="Nothing on the list"
        hint="Ask Claude for something and it'll track the steps here."
      />

      <div v-for="task in openTasks" :key="task.id" class="task-row">
        <TaskStatusControl
          size="compact"
          :status="task.status"
          @change="changeStatus(task, $event)"
        />
        <span class="task-title">{{ task.title }}</span>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.tasks-panel {
  display: grid;
  grid-template-rows: auto 1fr;
  min-height: 0;
  width: 260px;
  background: var(--bg-panel);
  border-left: 1px solid var(--hair);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--hair);
}

.panel-title {
  margin: 0;
  color: var(--ink-2);
  font: 600 12px/1.5 var(--font-ui);
}

.count-chip {
  color: var(--ink-3);
  font: 600 10.5px/1.5 var(--font-ui);
  border: 1px solid var(--hair);
  border-radius: 99px;
  padding: 0 8px;
}

.task-list {
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.task-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-s);
}

.task-row:hover {
  background: var(--row-hover);
}

.task-title {
  min-width: 0;
  color: var(--ink-1);
  font: 500 12.5px/1.5 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
