<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  PhCheck as Check,
  PhCaretDown as ChevronDown,
  PhCaretUp as ChevronUp,
  PhX as X,
} from "@phosphor-icons/vue";
import type { SessionTodoResponse } from "@vynel/contracts/tasks/session-todo-http";
import { useSessionTodos } from "../../composables/todos/use-session-todos.js";
import { useUpdateTodoStatus } from "../../composables/todos/use-update-todo-status.js";
import { useDeleteTodo } from "../../composables/todos/use-delete-todo.js";

// CURRENTLY UNRENDERED (2026-08-24): retired in favour of the task panel’s
// tasks + steps — the three views keep the element commented out, and
// set_todos no longer ships as a tool. Kept (with its test) for a deliberate
// reconnect.
// The working-steps dock: the step list the session keeps while it works,
// sitting directly above the composer in every chat. The session writes it
// with set_todos; the user can tick a step off or drop it. Empty = no dock at
// all (a conversation that needs no plan shows no chrome).
const props = defineProps<{
  /** The session the thread is showing. Null (a fresh thread) → hidden. */
  sessionId: string | null;
}>();

// Past this many steps the dock folds to its current step + a count, so a long
// plan never eats the composer's room.
const FOLD_THRESHOLD = 5;

const todosQuery = useSessionTodos(() => props.sessionId);
const updateStatus = useUpdateTodoStatus();
const removeTodo = useDeleteTodo();

const todos = computed<SessionTodoResponse[]>(() => todosQuery.data.value ?? []);
const doneCount = computed(
  () => todos.value.filter((todo) => todo.status === "done").length,
);

const isUnfolded = ref(false);
// A different thread is a different plan — never inherit the last one's fold.
watch(
  () => props.sessionId,
  () => (isUnfolded.value = false),
);

const showsEveryStep = computed(
  () => isUnfolded.value || todos.value.length <= FOLD_THRESHOLD,
);
/** Folded, the dock shows the step being worked (or the next one up). */
const currentStep = computed(
  () =>
    todos.value.find((todo) => todo.status === "in-progress") ??
    todos.value.find((todo) => todo.status === "open") ??
    null,
);
const visibleTodos = computed(() => {
  if (showsEveryStep.value) return todos.value;
  return currentStep.value === null ? [] : [currentStep.value];
});

function toggleDone(todo: SessionTodoResponse) {
  updateStatus.mutate({
    todoId: todo.id,
    status: todo.status === "done" ? "open" : "done",
  });
}
</script>

<template>
  <div v-if="todos.length > 0" class="todo-dock">
    <button
      type="button"
      class="todo-head"
      :aria-expanded="showsEveryStep"
      @click="isUnfolded = !isUnfolded"
    >
      <span class="todo-head-label">Steps</span>
      <span class="todo-head-count">{{ doneCount }}/{{ todos.length }}</span>
      <component
        :is="showsEveryStep ? ChevronDown : ChevronUp"
        :size="13"
        class="todo-head-chevron"
        aria-hidden="true"
      />
    </button>

    <ul class="todo-list">
      <li
        v-for="todo in visibleTodos"
        :key="todo.id"
        class="todo-row"
        :class="{
          'is-active': todo.status === 'in-progress',
          'is-done': todo.status === 'done',
        }"
      >
        <button
          type="button"
          class="todo-check"
          :aria-label="
            todo.status === 'done'
              ? `Reopen step: ${todo.title}`
              : `Mark step done: ${todo.title}`
          "
          @click="toggleDone(todo)"
        >
          <Check v-if="todo.status === 'done'" :size="11" aria-hidden="true" />
          <span v-else-if="todo.status === 'in-progress'" class="todo-pulse" />
        </button>
        <span class="todo-title">{{ todo.title }}</span>
        <button
          type="button"
          class="todo-remove"
          :aria-label="`Remove step: ${todo.title}`"
          @click="removeTodo.mutate({ todoId: todo.id })"
        >
          <X :size="11" aria-hidden="true" />
        </button>
      </li>
    </ul>

    <p v-if="!showsEveryStep" class="todo-folded-note">
      {{ todos.length - visibleTodos.length }} more
    </p>
  </div>
</template>

<style scoped>
.todo-dock {
  display: grid;
  gap: 3px;
  padding: 0 2px 8px;
}

/* The header doubles as the fold control — one target, no extra chrome. */
.todo-head {
  appearance: none;
  border: none;
  background: transparent;
  padding: 0 0 2px;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ink-3);
  font: 600 10.5px/1.4 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  cursor: pointer;
}

.todo-head:hover {
  color: var(--ink-2);
}

/* One focus ring for every control in the dock. */
.todo-head:focus-visible,
.todo-check:focus-visible,
.todo-remove:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
  border-radius: 99px;
}

.todo-head-count {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
}

.todo-head-chevron {
  opacity: 0.7;
}

.todo-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 1px;
}

.todo-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 6px 3px 4px;
  border-radius: var(--radius-s, 5px);
  color: var(--ink-2);
  font: 500 12.5px/1.5 var(--font-ui);
}

.todo-row:hover {
  background: var(--hair);
}

/* The step being worked is the one the eye should land on. */
.todo-row.is-active {
  background: var(--gold-soft);
  color: var(--ink-1);
  font-weight: 600;
}

.todo-row.is-done .todo-title {
  color: var(--ink-3);
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}

.todo-check {
  appearance: none;
  flex: none;
  margin: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border: 1.5px solid var(--hair-strong);
  border-radius: 99px;
  background: transparent;
  color: var(--bg-raised);
  cursor: pointer;
  transition: background var(--t-fast) var(--ease-out), border-color var(--t-fast) var(--ease-out);
}

.todo-check:hover {
  border-color: var(--ok);
}

.todo-row.is-active .todo-check {
  border-color: var(--gold);
}

.todo-row.is-done .todo-check {
  border-color: var(--ok);
  background: var(--ok);
}

/* The in-progress marker — a quiet breathing dot, never a spinner (the
   composer already says the turn is running). */
.todo-pulse {
  width: 5px;
  height: 5px;
  border-radius: 99px;
  background: var(--gold);
  animation: todo-breathe 1.8s var(--ease-out) infinite;
}

@keyframes todo-breathe {
  0%,
  100% {
    opacity: 0.45;
  }
  50% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .todo-pulse {
    animation: none;
    opacity: 1;
  }
}

.todo-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.todo-remove {
  appearance: none;
  border: none;
  flex: none;
  margin: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 17px;
  height: 17px;
  border-radius: 99px;
  background: transparent;
  color: var(--ink-3);
  opacity: 0;
  cursor: pointer;
}

.todo-row:hover .todo-remove,
.todo-remove:focus-visible {
  opacity: 1;
}

.todo-remove:hover {
  background: color-mix(in srgb, var(--danger) 15%, transparent);
  color: var(--danger);
}

.todo-folded-note {
  margin: 0;
  padding-left: 27px;
  color: var(--ink-3);
  font: 500 11.5px/1.5 var(--font-ui);
}
</style>
