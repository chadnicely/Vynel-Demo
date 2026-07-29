<script setup lang="ts">
import { onScopeDispose, watch, ref } from "vue";
import { ListChecks } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import { newlyCompletedIds } from "./recently-completed-diff.js";

// The tasks card with the completion celebration: when a task the user SAW
// open completes, its row draws a green check, washes, and FLIP-glides down
// into the delivered shelf. Guard: a transition observed while mounted — never
// on initial load, never replayed on refetch (recently-completed-diff.ts).
export interface DashboardTaskRow {
  id: string;
  title: string;
  status: string;
  completedAt: string | null;
}

const props = defineProps<{
  openTasks: DashboardTaskRow[];
  completedTasks: DashboardTaskRow[];
}>();

const CELEBRATE_MS = 1_600;

const celebratingIds = ref<ReadonlySet<string>>(new Set());
let previousOpenIds = new Set<string>();
const timers: ReturnType<typeof setTimeout>[] = [];

watch(
  () => [props.openTasks, props.completedTasks] as const,
  ([open, completed]) => {
    const fresh = newlyCompletedIds(previousOpenIds, completed);
    if (fresh.length > 0) {
      const next = new Set(celebratingIds.value);
      for (const id of fresh) next.add(id);
      celebratingIds.value = next;
      timers.push(
        setTimeout(() => {
          const after = new Set(celebratingIds.value);
          for (const id of fresh) after.delete(id);
          celebratingIds.value = after;
        }, CELEBRATE_MS),
      );
    }
    previousOpenIds = new Set(open.map((row) => row.id));
  },
  { immediate: true },
);

onScopeDispose(() => {
  for (const timer of timers) clearTimeout(timer);
});
</script>

<template>
  <section class="card span-2">
    <header class="card-header">
      <ListChecks :size="14" class="card-icon" />
      <p class="card-title">On the list</p>
    </header>
    <EmptyState
      v-if="props.openTasks.length === 0 && props.completedTasks.length === 0"
      title="Nothing on the list"
      hint="Ask Claude for something and it'll track the steps here."
    />
    <TransitionGroup v-else name="task" tag="div" class="task-list">
      <div
        v-for="task in props.openTasks"
        :key="task.id"
        class="list-row is-static task-row"
      >
        <span class="row-title">{{ task.title }}</span>
        <span
          class="task-pill"
          :class="{ 'is-in-progress': task.status === 'in-progress' }"
        >
          {{ task.status === "in-progress" ? "In progress" : "Open" }}
        </span>
      </div>
      <div
        v-for="task in props.completedTasks"
        :key="task.id"
        class="list-row is-static task-row is-completed"
        :class="{ 'is-celebrating': celebratingIds.has(task.id) }"
      >
        <svg
          class="check"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            class="check-path"
            d="M3 8.5l3.2 3.2L13 5"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span class="row-title">{{ task.title }}</span>
        <span class="row-meta">
          done
          {{ task.completedAt ? formatRelativeTime(task.completedAt) : "" }}
        </span>
      </div>
    </TransitionGroup>
  </section>
</template>

<style scoped>
.card {
  background: var(--bg-panel);
  border: 1px solid var(--hair);
  border-radius: var(--radius-m);
  padding: 12px;
  display: grid;
  gap: 4px;
  align-content: start;
}

.span-2 {
  grid-column: span 2;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 4px;
}

.card-icon {
  color: var(--ink-3);
}

.card-title {
  margin: 0;
  color: var(--ink-2);
  font: 600 11px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.07em;
}

.task-list {
  display: grid;
  gap: 1px;
}

.list-row {
  margin: 0;
  padding: 7px 8px;
  border-radius: var(--radius-s);
}

.task-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.row-title {
  flex: 1;
  min-width: 0;
  color: var(--ink-1);
  font: 500 12.5px/1.5 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-meta {
  flex: none;
  color: var(--ink-3);
  font: 400 10.5px/1.5 var(--font-ui);
}

/* The completed tail reads as a quiet log under the live list. */
.task-row.is-completed .row-title {
  color: var(--ink-3);
  text-decoration: line-through;
}

.check {
  flex: none;
  color: var(--ok);
}

.task-pill {
  flex: none;
  color: var(--ink-3);
  background: var(--row-active);
  font: 600 10.5px/1.6 var(--font-ui);
  border-radius: 99px;
  padding: 1px 8px;
}

.task-pill.is-in-progress {
  color: var(--info);
  background: color-mix(in srgb, var(--info) 12%, transparent);
}

/* Celebration: check draws itself, the row washes green then settles — the
   FLIP glide below carries it from the open list into the shelf. */
.is-celebrating {
  animation: row-wash 0.9s var(--ease-out, ease-out);
}

.is-celebrating .check-path {
  stroke-dasharray: 20;
  stroke-dashoffset: 20;
  animation: check-draw 0.3s 0.15s var(--ease-out, ease-out) forwards;
}

@keyframes check-draw {
  to {
    stroke-dashoffset: 0;
  }
}

@keyframes row-wash {
  0% {
    background: color-mix(in srgb, var(--ok) 10%, transparent);
  }
  100% {
    background: transparent;
  }
}

.task-move {
  transition: transform 0.4s var(--ease-out, ease-out);
}

.task-enter-active {
  transition: opacity 0.2s var(--ease-out, ease-out);
}

.task-enter-from {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .is-celebrating {
    animation: none;
  }

  .is-celebrating .check-path {
    animation: none;
    stroke-dashoffset: 0;
  }

  .task-move,
  .task-enter-active {
    transition: none;
  }
}
</style>
