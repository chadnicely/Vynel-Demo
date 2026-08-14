<script setup lang="ts">
import { computed, ref } from "vue";
import {
  PhArrowUpRight as ArrowUpRight,
  PhMonitor as Monitor,
  PhStopCircle as StopCircle,
} from "@phosphor-icons/vue";
import { EmptyState } from "@vynel/ui";
import type { TaskResponse, TaskStatus } from "@vynel/contracts/tasks/task-http";
import { useTasksInScope } from "../../composables/tasks/use-tasks-in-scope.js";
import { useUpdateTask } from "../../composables/tasks/use-update-task.js";
import { useSessionTodos } from "../../composables/todos/use-session-todos.js";
import { useWorkspaceApps } from "../../composables/workspace-apps/use-workspace-apps.js";
import { useWorkspacePresence } from "../../composables/workspaces/use-workspace-presence.js";
import { useActivityStore } from "../../stores/activity-store.js";
import { useVynel } from "../../composables/use-vynel.js";
import type { SectionScope } from "../sections/section-scope.js";
import TaskStatusControl from "./TaskStatusControl.vue";

// The workspace work rail (redesign Arc 4 — the canvas's right rail on OUR
// data): the live card reads the scope's presence + the running session's
// working steps, the queue/completed pills read the same scoped tasks query
// as TasksSection, and OPEN IT lists the workspace's actually-running apps
// (AppRow's plain-anchor pattern) plus the same per-scope interrupt the chat
// surfaces use. Still the opt-in dock — the title-bar toggle is unchanged.
const props = withDefaults(
  defineProps<{
    scope: SectionScope;
    /** Who works this scope — the workspace manager persona / the assistant. */
    assistantName?: string;
  }>(),
  { assistantName: "Assistant" },
);

const vynel = useVynel();
const activity = useActivityStore();
const tasksQuery = useTasksInScope(() => props.scope);
const updateTask = useUpdateTask();
const { presenceByWorkspaceId, globalPresence } = useWorkspacePresence();

const scopeWorkspaceId = computed(() =>
  props.scope.kind === "workspace" ? props.scope.workspaceId : null,
);

const presence = computed(() =>
  scopeWorkspaceId.value === null
    ? globalPresence.value
    : (presenceByWorkspaceId.value[scopeWorkspaceId.value] ?? "idle"),
);

const tasksInScope = computed(() => tasksQuery.data.value ?? []);
const queuedTasks = computed(() => {
  const open = tasksInScope.value.filter((row) => row.status !== "done");
  // The one being worked leads the queue — the canvas's reading order.
  return [
    ...open.filter((row) => row.status === "in-progress"),
    ...open.filter((row) => row.status === "open"),
  ];
});
const completedTasks = computed(() =>
  tasksInScope.value.filter((row) => row.status === "done"),
);

const listTab = ref<"queue" | "done">("queue");
const shownTasks = computed(() =>
  listTab.value === "done" ? completedTasks.value : queuedTasks.value,
);

// The scope's RUNNING session — the server turn map carries sessionId per
// scope; it anchors both the live card's steps and the interrupt target.
const liveSessionId = computed(() => {
  for (const turn of Object.values(activity.serverTurns)) {
    const matchesScope =
      scopeWorkspaceId.value === null
        ? turn.scopeKind === "global"
        : turn.scopeKind === "workspace" &&
          turn.workspaceId === scopeWorkspaceId.value;
    if (matchesScope) return turn.sessionId;
  }
  return null;
});

const liveTask = computed(
  () => queuedTasks.value.find((row) => row.status === "in-progress") ?? null,
);

// Steps for the live card: the running session's todos win (that IS what's
// happening now); a paused in-progress task shows its session's steps.
const todosQuery = useSessionTodos(
  () => liveSessionId.value ?? liveTask.value?.sessionId ?? null,
);
const stepProgress = computed(() => {
  const todos = todosQuery.data.value ?? [];
  if (todos.length === 0) return null;
  const done = todos.filter((todo) => todo.status === "done").length;
  return { done, total: todos.length, pct: Math.round((100 * done) / todos.length) };
});

const liveKicker = computed(() => {
  if (presence.value === "attention") return "Waiting on you";
  if (presence.value === "working") return `${props.assistantName} working`;
  return "All quiet";
});
const liveTitle = computed(() => {
  if (liveTask.value !== null) return liveTask.value.title;
  if (presence.value === "working") return "Working in the chat";
  if (presence.value === "attention") return "Something needs your answer";
  return "Nothing running";
});
const liveMeta = computed(() => {
  if (presence.value === "attention") return "Open the chat to answer";
  if (presence.value === "working") return "Building now";
  const open = queuedTasks.value.length;
  return open === 0
    ? "Pick it up when you are ready"
    : `${open} in the queue, waiting`;
});

// ── OPEN IT — the workspace's running apps as plain anchors (the AppRow
// mechanism), and the same per-scope interrupt the chat surfaces call. ──
const appsQuery = useWorkspaceApps(scopeWorkspaceId);
const openableApps = computed(() =>
  (appsQuery.data.value ?? []).filter(
    (app) => app.port !== null && app.runtime?.status === "running",
  ),
);

const isAbortConfirmOpen = ref(false);
const isInterrupting = ref(false);
// Workspace-only by design — the stop lives in the OPEN IT block, and the
// Global surface already carries its own interrupt on the live turn.
async function abortLiveSession() {
  const sessionId = liveSessionId.value;
  isAbortConfirmOpen.value = false;
  if (isInterrupting.value) return;
  if (props.scope.kind !== "workspace" || sessionId === null) return;
  isInterrupting.value = true;
  try {
    await vynel.chat.interruptSession(props.scope.workspaceId, sessionId);
  } catch {
    // The turn may have settled between the click and the call — the rail's
    // presence view corrects itself on the next activity event either way.
  } finally {
    isInterrupting.value = false;
  }
}

function changeStatus(task: TaskResponse, status: TaskStatus) {
  updateTask.mutate({ taskId: task.id, status });
}

function completedAtLabel(task: TaskResponse): string {
  if (task.completedAt === null) return "";
  return new Date(task.completedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
</script>

<template>
  <aside class="work-rail">
    <!-- The live card — presence, what's being worked, and its real steps. -->
    <div
      class="live-card"
      :class="{
        'is-working': presence === 'working',
        'is-attention': presence === 'attention',
      }"
    >
      <p class="live-kicker">
        <span class="live-dot" aria-hidden="true" />
        {{ liveKicker }}
      </p>
      <p class="live-title">{{ liveTitle }}</p>
      <p class="live-meta">{{ liveMeta }}</p>
      <template v-if="stepProgress">
        <span class="live-bar">
          <span class="live-bar-fill" :style="{ width: `${stepProgress.pct}%` }" />
        </span>
        <p class="live-bar-label">
          {{ stepProgress.done }} of {{ stepProgress.total }} steps completed
        </p>
      </template>
    </div>

    <!-- Queue | Completed — the canvas's pill segment on the scoped query. -->
    <div class="list-tabs" role="tablist" aria-label="Task lists">
      <button
        type="button"
        role="tab"
        :aria-selected="listTab === 'queue'"
        class="list-tab"
        :class="{ 'is-active': listTab === 'queue' }"
        @click="listTab = 'queue'"
      >
        In the queue <span class="tab-count">{{ queuedTasks.length }}</span>
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="listTab === 'done'"
        class="list-tab"
        :class="{ 'is-active': listTab === 'done' }"
        @click="listTab = 'done'"
      >
        Completed <span class="tab-count">{{ completedTasks.length }}</span>
      </button>
    </div>

    <div class="task-list">
      <EmptyState
        v-if="shownTasks.length === 0"
        :title="listTab === 'done' ? 'Nothing finished yet' : 'Nothing on the list'"
        :hint="
          listTab === 'done'
            ? 'Completed tasks land here.'
            : 'Ask for something and it\'ll track the steps here.'
        "
      />

      <div
        v-for="task in shownTasks"
        :key="task.id"
        class="task-row"
        :class="{ 'is-done': task.status === 'done' }"
      >
        <TaskStatusControl
          size="compact"
          :status="task.status"
          @change="changeStatus(task, $event)"
        />
        <span class="task-title" :title="task.title">{{ task.title }}</span>
        <span v-if="task.status === 'done'" class="task-meta">
          {{ completedAtLabel(task) }}
        </span>
        <span v-else-if="task.status === 'in-progress'" class="task-meta is-live">
          now
        </span>
      </div>
    </div>

    <!-- OPEN IT — real running apps + the real interrupt. Workspace rooms
         only; Global has no apps to open. -->
    <div v-if="props.scope.kind === 'workspace'" class="open-it">
      <p class="open-it-label">Open it</p>
      <a
        v-for="app in openableApps"
        :key="app.id"
        class="open-row"
        :href="`http://localhost:${app.port}`"
        target="_blank"
        rel="noreferrer"
      >
        <Monitor :size="14" class="open-icon" />
        <span class="open-text">
          <span class="open-name">Open {{ app.name }}</span>
          <span class="open-value">localhost:{{ app.port }}</span>
        </span>
        <ArrowUpRight :size="12" class="open-arrow" />
      </a>
      <p v-if="openableApps.length === 0" class="open-empty">
        Nothing running to open.
      </p>

      <template v-if="presence === 'working' && liveSessionId !== null">
        <button
          type="button"
          class="abort-button"
          @click="isAbortConfirmOpen = !isAbortConfirmOpen"
        >
          <StopCircle :size="14" />
          Stop the current work
        </button>
        <div v-if="isAbortConfirmOpen" class="abort-confirm">
          <p class="abort-note">
            Stops what {{ props.assistantName }} is doing right now. Finished
            work stays; the step in flight is dropped.
          </p>
          <div class="abort-actions">
            <button
              type="button"
              class="abort-keep"
              @click="isAbortConfirmOpen = false"
            >
              Keep going
            </button>
            <button type="button" class="abort-do" @click="abortLiveSession">
              Stop it
            </button>
          </div>
        </div>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.work-rail {
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  gap: 12px;
  min-height: 0;
  width: 272px;
  padding: 14px 12px;
  background: var(--bg-panel);
  border-left: 1px solid var(--hair);
}

/* ── The live card. Presence carries the tint: gold while working, the
   needs-input blue while waiting on the user, quiet otherwise. ── */
.live-card {
  display: grid;
  gap: 6px;
  padding: 12px;
  border-radius: var(--radius-m);
  background: var(--bg-raised);
  border: 1px solid var(--hair);
  border-left: 2px solid var(--hair-strong);
}

.live-card.is-working {
  background: color-mix(in srgb, var(--gold) 10%, transparent);
  border-color: color-mix(in srgb, var(--gold) 45%, transparent);
  border-left-color: var(--gold);
}

.live-card.is-attention {
  background: var(--needs-input-soft);
  border-color: color-mix(in srgb, var(--needs-input) 45%, transparent);
  border-left-color: var(--needs-input);
}

.live-kicker {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ink-3);
  font: 600 10px/1.5 var(--font-ui);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.is-working .live-kicker {
  color: var(--gold-bright);
}

.is-attention .live-kicker {
  color: var(--needs-input);
}

.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ink-3);
}

.is-working .live-dot {
  background: var(--gold);
  box-shadow: 0 0 8px color-mix(in srgb, var(--gold) 60%, transparent);
}

.is-attention .live-dot {
  background: var(--needs-input);
  animation: rail-dot-pulse 1.4s ease-in-out infinite;
}

@keyframes rail-dot-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

.live-title {
  margin: 0;
  color: var(--ink-1);
  font: 600 13px/1.35 var(--font-ui);
  text-wrap: pretty;
}

.live-meta {
  margin: 0;
  color: var(--ink-3);
  font: 500 10.5px/1.5 var(--font-ui);
}

.live-bar {
  height: 3px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--ink-3) 25%, transparent);
  overflow: hidden;
}

.live-bar-fill {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--gold);
  box-shadow: 0 0 10px color-mix(in srgb, var(--gold) 60%, transparent);
  transition: width var(--t-slow) var(--ease-out);
}

.live-bar-label {
  margin: 0;
  color: var(--ink-3);
  font: 500 10px/1.5 var(--font-ui);
}

/* ── The queue/completed pill segment. ── */
.list-tabs {
  display: flex;
  gap: 3px;
  padding: 3px;
  border-radius: 999px;
  border: 1px solid var(--hair);
  background: var(--bg-inset);
}

.list-tab {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  color: var(--ink-3);
  font: 600 11px/1.5 var(--font-ui);
  transition:
    background var(--t-fast) var(--ease-out),
    color var(--t-fast) var(--ease-out);
}

.list-tab:hover {
  color: var(--ink-1);
}

.list-tab.is-active {
  background: var(--row-active);
  color: var(--ink-1);
}

.tab-count {
  font-variant-numeric: tabular-nums;
  color: var(--ink-3);
}

.list-tab.is-active .tab-count {
  color: var(--gold-bright);
}

.task-list {
  overflow-y: auto;
  min-height: 0;
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

.task-row.is-done {
  opacity: 0.6;
}

.task-title {
  min-width: 0;
  flex: 1;
  color: var(--ink-1);
  font: 500 12px/1.5 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-meta {
  color: var(--ink-3);
  font: 500 10px/1.5 var(--font-ui);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.task-meta.is-live {
  color: var(--gold-bright);
}

/* ── OPEN IT. ── */
.open-it {
  display: grid;
  gap: 6px;
  padding-top: 12px;
  border-top: 1px solid var(--hair);
}

.open-it-label {
  margin: 0 0 2px;
  color: var(--ink-3);
  font: 600 10px/1.5 var(--font-ui);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.open-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--gold) 40%, transparent);
  border-radius: var(--radius-m);
  color: var(--gold-bright);
  text-decoration: none;
  transition: background var(--t-fast) var(--ease-out);
}

.open-row:hover {
  background: color-mix(in srgb, var(--gold) 12%, transparent);
}

.open-icon {
  flex: none;
}

.open-text {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 1px;
}

.open-name {
  font: 600 12px/1.4 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.open-value {
  color: var(--ink-3);
  font: 500 10px/1.4 var(--font-mono);
}

.open-arrow {
  flex: none;
  color: var(--ink-3);
}

.open-empty {
  margin: 0;
  color: var(--ink-3);
  font: 500 11px/1.5 var(--font-ui);
}

.abort-button {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--danger) 38%, transparent);
  border-radius: var(--radius-m);
  color: var(--danger);
  font: 600 12px/1.4 var(--font-ui);
  transition:
    background var(--t-fast) var(--ease-out),
    color var(--t-fast) var(--ease-out);
}

.abort-button:hover {
  background: color-mix(in srgb, var(--danger) 14%, transparent);
}

.abort-confirm {
  display: grid;
  gap: 8px;
  padding: 10px 11px;
  border-radius: var(--radius-m);
  background: color-mix(in srgb, var(--danger) 9%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger) 40%, transparent);
}

.abort-note {
  margin: 0;
  color: var(--ink-1);
  font: 500 11px/1.45 var(--font-ui);
  text-wrap: pretty;
}

.abort-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.abort-keep {
  padding: 4px 11px;
  border-radius: var(--radius-s);
  color: var(--ink-2);
  font: 600 11px/1.5 var(--font-ui);
}

.abort-keep:hover {
  background: var(--row-hover);
  color: var(--ink-1);
}

.abort-do {
  padding: 4px 12px;
  border-radius: var(--radius-s);
  background: color-mix(in srgb, var(--danger) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger) 45%, transparent);
  color: var(--danger);
  font: 600 11px/1.5 var(--font-ui);
}

.abort-do:hover {
  background: color-mix(in srgb, var(--danger) 26%, transparent);
}
</style>
