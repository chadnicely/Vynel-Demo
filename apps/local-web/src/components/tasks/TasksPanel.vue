<script setup lang="ts">
import { computed, ref } from "vue";
import { nextTick } from "vue";
import {
  PhArrowUpRight as ArrowUpRight,
  PhCalendarBlank as CalendarBlank,
  PhCaretRight as CaretRight,
  PhChatCircle as ChatCircle,
  PhCheckCircle as CheckCircle,
  PhCircleDashed as CircleDashed,
  PhCircleHalf as CircleHalf,
  PhMonitor as Monitor,
  PhPlus as Plus,
  PhStopCircle as StopCircle,
} from "@phosphor-icons/vue";
import { EmptyState } from "@vynel/ui";
import type { TaskResponse, TaskStatus } from "@vynel/contracts/tasks/task-http";
import type { TaskStepStatus } from "@vynel/contracts/tasks/task-step-http";
import { useCreateTask } from "../../composables/tasks/use-create-task.js";
import { useTasksInScope } from "../../composables/tasks/use-tasks-in-scope.js";
import { useUpdateTask } from "../../composables/tasks/use-update-task.js";
import { useTaskSteps } from "../../composables/tasks/use-task-steps.js";
import { useUpdateStepStatus } from "../../composables/tasks/use-update-step-status.js";
import { usePlanForTask } from "../../composables/plans/use-plan-for-task.js";
import { useSessionsOverview } from "../../composables/sessions/use-sessions-overview.js";
import TaskViewDialog from "./TaskViewDialog.vue";
import { useSessionTodos } from "../../composables/todos/use-session-todos.js";
import { useWorkspaceApps } from "../../composables/workspace-apps/use-workspace-apps.js";
import { useWorkspaceStatuses } from "../../composables/workspaces/use-workspace-status.js";
import { useActivityStore } from "../../stores/activity-store.js";
import { useConversationSidebarStore } from "../../stores/conversation-sidebar-store.js";
import { useUiStore } from "../../stores/ui-store.js";
import { useVynel } from "../../composables/use-vynel.js";
import type { SectionScope } from "../sections/section-scope.js";
import TaskStatusControl from "./TaskStatusControl.vue";

// The workspace work rail (redesign Arc 4 — the canvas's right rail on OUR
// data): the live card reads the scope's presence + the running session's
// working steps, the queue/completed pills read the same scoped tasks query
// as TasksSection, and OPEN IT lists the workspace's actually-running apps
// (AppRow's plain-anchor pattern) plus the same per-scope interrupt the chat
// surfaces use. OPEN BY DEFAULT since the task-execution arc (2026-08-18) —
// tasks are the scope's work queue now; the title-bar toggle still closes it.
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
const { statusByWorkspaceId, globalStatus } = useWorkspaceStatuses();

const scopeWorkspaceId = computed(() =>
  props.scope.kind === "workspace" ? props.scope.workspaceId : null,
);

// The scope's effective status — one status, one colour (Arc 5b).
const statusView = computed(() =>
  scopeWorkspaceId.value === null
    ? null
    : (statusByWorkspaceId.value[scopeWorkspaceId.value] ?? null),
);
const scopeStatus = computed(() =>
  scopeWorkspaceId.value === null
    ? globalStatus.value
    : (statusView.value?.status ?? "not_running"),
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

// EVERY running turn in this scope — the activity header's "sessions working"
// count and the sessions box's rows. The first one anchors the live card's
// steps and the interrupt target, as before.
const workingTurns = computed(() =>
  Object.values(activity.serverTurns).filter((turn) =>
    scopeWorkspaceId.value === null
      ? turn.scopeKind === "global"
      : turn.scopeKind === "workspace" &&
        turn.workspaceId === scopeWorkspaceId.value,
  ),
);

// The scope's RUNNING session — the server turn map carries sessionId per
// scope; it anchors both the live card's steps and the interrupt target.
const liveSessionId = computed(() => workingTurns.value[0]?.sessionId ?? null);

// ── The activity header: the scope's done/total rollup + who is working. ──
const activityCounts = computed(() => ({
  done: completedTasks.value.length,
  total: tasksInScope.value.length,
}));

// The sessions box — collapsed it advertises the count; expanded it lists
// this scope's working sessions by name (titles from the shared overview
// query, fetched only while the box is open; always scope-filtered — the
// standing rule for every session surface).
const isSessionsBoxOpen = ref(false);
const sessionsOverviewQuery = useSessionsOverview(isSessionsBoxOpen);
const workingSessions = computed(() =>
  workingTurns.value.flatMap((turn) => {
    // A turn that hasn't resolved its session yet has no row to name.
    if (turn.sessionId === null) return [];
    const sessionId = turn.sessionId;
    const entry = (sessionsOverviewQuery.data.value ?? []).find(
      (row) =>
        row.sessionId === sessionId ||
        row.segments.some((segment) => segment.sessionId === sessionId),
    );
    return [{ sessionId, title: entry?.title ?? "A conversation" }];
  }),
);

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

// The canvas's kicker vocabulary — one line per state.
const liveKicker = computed(() => {
  if (scopeStatus.value === "needs_input") return "Waiting on you";
  if (scopeStatus.value === "problem") return "Hit a problem";
  if (scopeStatus.value === "completed") return "All tasks done";
  if (scopeStatus.value === "running") return `${props.assistantName} working`;
  return "Not running";
});
const liveTitle = computed(() => {
  if (liveTask.value !== null) return liveTask.value.title;
  if (scopeStatus.value === "running") return "Working in the chat";
  if (scopeStatus.value === "needs_input") return "Something needs your answer";
  if (scopeStatus.value === "problem") return "Stopped on an error";
  if (scopeStatus.value === "completed") return "Everything on the list is done";
  return "Nothing running";
});
const liveMeta = computed(() => {
  // The assistant's own one-line why (set_workspace_status note) wins.
  const note = statusView.value?.note;
  if (note != null && note !== "") return note;
  if (scopeStatus.value === "needs_input") return "Open the chat to answer";
  if (scopeStatus.value === "problem") return "Open the chat to see what broke";
  if (scopeStatus.value === "running") return "Building now";
  const open = queuedTasks.value.length;
  return open === 0
    ? "Pick it up when you are ready"
    : `${open} in the queue, waiting`;
});
// The end-state progress line — the canvas's "N of M tasks done" trio
// (no invented counts: the state itself is the suffix's story).
const taskProgressLabel = computed(() => {
  const view = statusView.value;
  if (view === null || view.tasksTotal === 0) return null;
  if (scopeStatus.value === "completed")
    return `${view.tasksTotal} of ${view.tasksTotal} tasks completed`;
  if (scopeStatus.value === "needs_input" || scopeStatus.value === "problem")
    return `${view.tasksDone} of ${view.tasksTotal} tasks done`;
  return null;
});
const taskProgressPct = computed(() => {
  const view = statusView.value;
  if (view === null || view.tasksTotal === 0) return 0;
  return Math.round((100 * view.tasksDone) / view.tasksTotal);
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

// ── The step expander — one task's durable plan-of-record, unfolded in
// place (accordion: one open at a time keeps the fetch bounded). The
// collapsed row already shows n/m from the list's rollup. ──
const expandedTaskId = ref<string | null>(null);
const expandedStepsQuery = useTaskSteps(expandedTaskId);
const expandedSteps = computed(() => expandedStepsQuery.data.value ?? []);
const updateStepStatus = useUpdateStepStatus();

// THE ACTIVE TASK'S CURRENT STEP (Kafi's sketch, 2026-08-18): the in-progress
// task carries a live sub-line under its collapsed row — the step being
// worked right now, breathing like the chat's working pill — so the queue
// answers "what is happening" without expanding. Its steps stay fetched while
// a task is live (one bounded query; vue-query dedupes with the expander's).
const liveTaskStepsQuery = useTaskSteps(() => liveTask.value?.id ?? null);
const liveCurrentStep = computed(() => {
  const steps = liveTaskStepsQuery.data.value ?? [];
  const index = (() => {
    const working = steps.findIndex((step) => step.status === "in-progress");
    if (working !== -1) return working;
    return steps.findIndex((step) => step.status === "open");
  })();
  if (index === -1) return null;
  return { number: index + 1, title: steps[index]!.title };
});

// The expanded task's PLAN + SESSION doors (the sketch's icon row): the plan
// icon opens the shared review dialog on either relation (the day-plan link
// or the execution plan whose taskId points here); the session icon opens the
// ASSIGNED session's real conversation in the sidebar — the same door the
// working rail's edge chips open (Kafi, 2026-08-18: never the sessions tab).
const ui = useUiStore();
const sidebar = useConversationSidebarStore();
const expandedTask = computed(
  () => tasksInScope.value.find((row) => row.id === expandedTaskId.value) ?? null,
);
const { plan: planForExpandedTask } = usePlanForTask(expandedTaskId);
const expandedLinkedPlanId = computed(
  () => expandedTask.value?.planId ?? planForExpandedTask.value?.id ?? null,
);

function openExpandedPlan() {
  if (expandedLinkedPlanId.value === null) return;
  ui.viewingPlanId = expandedLinkedPlanId.value;
}

function sessionTitleFor(sessionId: string): string {
  const entry = (sessionsOverviewQuery.data.value ?? []).find(
    (row) =>
      row.sessionId === sessionId ||
      row.segments.some((segment) => segment.sessionId === sessionId),
  );
  return entry?.title ?? "Conversation";
}

function openAssignedSession(task: TaskResponse) {
  if (task.assignedSessionId === null) return;
  sidebar.openSession({
    sessionId: task.assignedSessionId,
    title: sessionTitleFor(task.assignedSessionId),
  });
}

function toggleExpanded(task: TaskResponse) {
  expandedTaskId.value = expandedTaskId.value === task.id ? null : task.id;
}

// Clicking a step's glyph ticks it done; clicking a done step reopens it.
function tickStep(stepId: string, status: TaskStepStatus) {
  updateStepStatus.mutate({
    stepId,
    status: status === "done" ? "open" : "done",
  });
}

function stepCountLabel(task: TaskResponse): string | null {
  if (!task.stepsTotal) return null;
  return `${task.stepsDone ?? 0}/${task.stepsTotal}`;
}

// The active task's collapsed row hands its meta to the SUB-LINE (the
// sketch): while the current step breathes underneath, the row itself keeps
// only the caret — "now" and the n/m would say the same thing twice.
function showsLiveSubline(task: TaskResponse): boolean {
  return (
    task.status === "in-progress" &&
    task.id === liveTask.value?.id &&
    expandedTaskId.value !== task.id &&
    liveCurrentStep.value !== null
  );
}

// A row opens the full task view (status, detail, the session's real steps).
const viewingTaskId = ref<string | null>(null);

// Quick add — the same create the Tasks section does, scoped to this rail.
const createTask = useCreateTask();
const isCreateOpen = ref(false);
const newTaskTitle = ref("");
const createInput = ref<HTMLInputElement | null>(null);

function openCreate() {
  listTab.value = "queue";
  isCreateOpen.value = true;
  void nextTick(() => createInput.value?.focus());
}

function cancelCreate(event: KeyboardEvent) {
  // Esc mid-IME-composition cancels the COMPOSITION, not the draft.
  if (event.isComposing) return;
  isCreateOpen.value = false;
  newTaskTitle.value = "";
}

function addTask() {
  const title = newTaskTitle.value.trim();
  if (title.length === 0 || createTask.isPending.value) return;
  createTask.mutate(
    props.scope.kind === "workspace"
      ? { scope: "workspace", workspaceId: props.scope.workspaceId, title }
      : { scope: "global", title },
    {
      onSuccess: () => {
        newTaskTitle.value = "";
        isCreateOpen.value = false;
      },
    },
  );
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
    <!-- The activity header — the scope's rollup at a glance: tasks done of
         total, and who is working. The sessions box expands into the scope's
         working sessions (always workspace-filtered). -->
    <header class="rail-activity">
      <p class="activity-line">
        <span class="activity-count">{{ activityCounts.done }}/{{ activityCounts.total }}</span>
        tasks done
      </p>
      <button
        type="button"
        class="sessions-box"
        :aria-expanded="isSessionsBoxOpen"
        @click="isSessionsBoxOpen = !isSessionsBoxOpen"
      >
        <span class="activity-count">{{ workingTurns.length }}</span>
        {{ workingTurns.length === 1 ? "session" : "sessions" }} working
        <CaretRight
          :size="10"
          class="sessions-caret"
          :class="{ 'is-open': isSessionsBoxOpen }"
        />
      </button>
      <ul v-if="isSessionsBoxOpen" class="sessions-list">
        <!-- Each row opens the session's REAL conversation in the sidebar —
             the same door the working rail's edge chips open. -->
        <li v-for="session in workingSessions" :key="session.sessionId">
          <button
            type="button"
            class="sessions-row"
            :title="session.title"
            @click="
              sidebar.openSession({
                sessionId: session.sessionId,
                title: session.title,
              })
            "
          >
            <span class="sessions-dot" aria-hidden="true" />
            <span class="sessions-title">{{ session.title }}</span>
          </button>
        </li>
        <li v-if="workingSessions.length === 0" class="sessions-empty">
          Nothing working right now.
        </li>
      </ul>
    </header>

    <!-- The live card — the scope's status, what's being worked, and the
         real numbers: session steps while running, the task rollup in the
         end states. One status, one colour. -->
    <div class="live-card" :data-status="scopeStatus">
      <p class="live-kicker">
        <span class="live-dot" aria-hidden="true" />
        {{ liveKicker }}
      </p>
      <p class="live-title">{{ liveTitle }}</p>
      <p class="live-meta">{{ liveMeta }}</p>
      <template v-if="scopeStatus === 'running' && stepProgress">
        <span class="live-bar">
          <span class="live-bar-fill" :style="{ width: `${stepProgress.pct}%` }" />
        </span>
        <p class="live-bar-label">
          {{ stepProgress.done }} of {{ stepProgress.total }} steps completed
        </p>
      </template>
      <template v-else-if="taskProgressLabel">
        <span class="live-bar">
          <span class="live-bar-fill" :style="{ width: `${taskProgressPct}%` }" />
        </span>
        <p class="live-bar-label">{{ taskProgressLabel }}</p>
      </template>
    </div>

    <!-- Queue | Completed — the canvas's pill segment on the scoped query.
         The tablist wraps ONLY the tabs; the add button shares the pill
         visually but stays outside the tablist semantics (ARIA owned-
         children rule). -->
    <div class="list-tabs">
      <div class="list-tabs-group" role="tablist" aria-label="Task lists">
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
      <button
        type="button"
        aria-label="Add a task"
        title="Add a task"
        class="add-task"
        @click="openCreate"
      >
        <Plus :size="12" />
      </button>
    </div>

    <div class="task-list">
      <!-- Form submit, not a keydown handler — implicit submission never
           fires mid-IME-composition (the TasksSection precedent). -->
      <form
        v-if="isCreateOpen"
        class="create-row"
        @submit.prevent="addTask"
      >
        <input
          ref="createInput"
          v-model="newTaskTitle"
          class="create-input"
          placeholder="What needs doing?"
          maxlength="200"
          @keydown.esc="cancelCreate"
        />
      </form>
      <EmptyState
        v-if="shownTasks.length === 0"
        :title="listTab === 'done' ? 'Nothing finished yet' : 'Nothing on the list'"
        :hint="
          listTab === 'done'
            ? 'Completed tasks land here.'
            : 'Ask for something and it\'ll track the steps here.'
        "
      />

      <template v-for="(task, taskIndex) in shownTasks" :key="task.id">
        <div
          class="task-row"
          :class="{
            'is-done': task.status === 'done',
            'is-live': task.status === 'in-progress',
          }"
        >
          <TaskStatusControl
            size="compact"
            :status="task.status"
            @change="changeStatus(task, $event)"
          />
          <button
            type="button"
            class="task-title"
            :title="task.title"
            @click="viewingTaskId = task.id"
          >
            {{ taskIndex + 1 }}. {{ task.title }}
          </button>
          <span v-if="task.status === 'done'" class="task-meta">
            {{ completedAtLabel(task) }}
          </span>
          <span
            v-else-if="task.status === 'in-progress' && !showsLiveSubline(task)"
            class="task-meta is-live"
          >
            now
          </span>
          <!-- The step expander — only tasks that HAVE steps get the fold.
               The active row keeps the caret alone; its sub-line carries the
               count. -->
          <button
            v-if="stepCountLabel(task)"
            type="button"
            class="step-toggle"
            :aria-expanded="expandedTaskId === task.id"
            :aria-label="`Show the steps of ${task.title}`"
            @click="toggleExpanded(task)"
          >
            <span v-if="!showsLiveSubline(task)" class="step-count">
              {{ stepCountLabel(task) }}
            </span>
            <CaretRight
              :size="10"
              class="step-caret"
              :class="{ 'is-open': expandedTaskId === task.id }"
            />
          </button>
        </div>
        <!-- The live sub-line — the sketch's "2. fixing …  (2/5)": the step
             being worked RIGHT NOW breathes under the active task's collapsed
             row; expanding replaces it with the full list. -->
        <div
          v-if="
            task.status === 'in-progress' &&
            task.id === liveTask?.id &&
            expandedTaskId !== task.id &&
            liveCurrentStep
          "
          class="live-step-line"
        >
          <span class="live-step-dot" aria-hidden="true" />
          <span class="live-step-title" :title="liveCurrentStep.title">
            {{ liveCurrentStep.number }}. {{ liveCurrentStep.title }}
          </span>
          <span v-if="stepCountLabel(task)" class="live-step-count">
            {{ stepCountLabel(task) }}
          </span>
        </div>
        <ul v-if="expandedTaskId === task.id" class="step-list">
          <!-- The sketch's icon row: the task's plan + its working session,
               one click each, sitting above the steps. -->
          <li
            v-if="expandedLinkedPlanId || task.assignedSessionId"
            class="step-actions"
          >
            <button
              v-if="expandedLinkedPlanId"
              type="button"
              class="step-action"
              title="View the plan"
              aria-label="View the plan behind this task"
              @click="openExpandedPlan"
            >
              <CalendarBlank :size="12" />
              Plan
            </button>
            <button
              v-if="task.assignedSessionId"
              type="button"
              class="step-action"
              title="Open the session working this task"
              aria-label="Open the session working this task"
              @click="openAssignedSession(task)"
            >
              <ChatCircle :size="12" />
              Session
            </button>
          </li>
          <li v-for="step in expandedSteps" :key="step.id" class="step-row">
            <button
              type="button"
              class="step-tick"
              :aria-label="
                step.status === 'done' ? 'Reopen this step' : 'Mark this step done'
              "
              @click="tickStep(step.id, step.status)"
            >
              <CheckCircle
                v-if="step.status === 'done'"
                :size="13"
                class="step-icon is-done"
              />
              <CircleHalf
                v-else-if="step.status === 'in-progress'"
                :size="13"
                class="step-icon is-live"
              />
              <CircleDashed v-else :size="13" class="step-icon" />
            </button>
            <span
              class="step-title"
              :class="{ 'is-done': step.status === 'done' }"
              :title="step.title"
            >
              {{ step.title }}
            </span>
          </li>
          <li v-if="expandedSteps.length === 0" class="step-empty">
            No steps laid out yet.
          </li>
        </ul>
      </template>
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

      <template v-if="scopeStatus === 'running' && liveSessionId !== null">
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

    <TaskViewDialog
      :open="viewingTaskId !== null"
      :task-id="viewingTaskId"
      @close="viewingTaskId = null"
    />
  </aside>
</template>

<style scoped>
/* WEIGHT 400 on every micro-label in this rail, and quiet ink on the rows —
   the tracking carries a label, not the weight. The chat card took this
   correction in an earlier pass; the rail was measured against the canvas and
   was running 600/500 and near-white throughout. */
.work-rail {
  display: grid;
  grid-template-rows: auto auto auto 1fr auto;
  gap: var(--space-6);
  min-height: 0;
  /* 320, up from 272 (Kafi, 2026-08-18): rows carry step counts + expanders
     now — titles were truncating too early in the narrow column. */
  width: 320px;
  padding: var(--space-8) var(--space-6);
  /* The canvas rail carries no panel ground of its own — it sits on the app
     floor, separated by the hairline alone, so the tinted live card reads as
     the one lit thing in the column. --bg-panel put it only 6% off the card. */
  background: var(--color-bg);
  border-left: 1px solid var(--hair);
}

/* ── The activity header — the same quiet micro-label voice as the rest of
   the rail; the counts alone carry ink. ── */
.rail-activity {
  display: grid;
  gap: 4px;
}

.activity-line {
  margin: 0;
  color: var(--ink-3);
  font: 400 10.5px/1.5 var(--font-ui);
}

.activity-count {
  color: var(--ink-1);
  font-variant-numeric: tabular-nums;
}

.sessions-box {
  display: flex;
  align-items: center;
  gap: 5px;
  width: fit-content;
  padding: 0;
  color: var(--ink-3);
  font: 400 10.5px/1.5 var(--font-ui);
  transition: color var(--t-fast) var(--ease-out);
}

.sessions-box:hover {
  color: var(--ink-1);
}

.sessions-caret {
  transition: transform var(--t-fast) var(--ease-out);
}

.sessions-caret.is-open {
  transform: rotate(90deg);
}

.sessions-list {
  margin: 2px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 3px;
}

.sessions-row {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-width: 0;
  padding: 2px 4px;
  border-radius: var(--radius-s);
  text-align: left;
  transition: background var(--t-fast) var(--ease-out);
}

.sessions-row:hover {
  background: var(--row-hover);
}

.sessions-dot {
  flex: none;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--gold);
  box-shadow: 0 0 6px color-mix(in srgb, var(--gold) 60%, transparent);
}

.sessions-title {
  min-width: 0;
  color: var(--ink-2);
  font: 400 11px/1.5 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sessions-empty {
  padding-left: 4px;
  color: var(--ink-3);
  font: 400 10.5px/1.5 var(--font-ui);
}

/* ── The live card. The status carries the tint — one status, one colour:
   accent while working, blue waiting on you, red problem, green done. ── */
.live-card {
  display: grid;
  gap: 6px;
  padding: 12px;
  border-radius: var(--radius-m);
  background: var(--bg-raised);
  border: 1px solid var(--hair);
  border-left: 2px solid var(--hair-strong);
}

.live-card[data-status="running"] {
  background: var(--color-accent-900);
  border-color: color-mix(in srgb, var(--gold) 55%, transparent);
  border-left-color: var(--gold);
}

.live-card[data-status="needs_input"] {
  background: var(--needs-input-soft);
  border-color: color-mix(in srgb, var(--needs-input) 45%, transparent);
  border-left-color: var(--needs-input);
}

.live-card[data-status="problem"] {
  background: color-mix(in srgb, var(--danger) 9%, transparent);
  border-color: color-mix(in srgb, var(--danger) 45%, transparent);
  border-left-color: var(--danger);
}

.live-card[data-status="completed"] {
  background: color-mix(in srgb, var(--ok) 10%, transparent);
  border-color: color-mix(in srgb, var(--ok) 45%, transparent);
  border-left-color: var(--ok);
}

.live-kicker {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ink-3);
  font: 400 10px/1.5 var(--font-ui);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

[data-status="running"] .live-kicker {
  color: var(--color-accent-200);
}

[data-status="needs_input"] .live-kicker {
  color: var(--needs-input);
}

[data-status="problem"] .live-kicker {
  color: var(--danger);
}

[data-status="completed"] .live-kicker {
  color: var(--ok);
}

.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ink-3);
}

[data-status="running"] .live-dot {
  background: var(--gold);
  box-shadow: 0 0 8px color-mix(in srgb, var(--gold) 60%, transparent);
}

[data-status="needs_input"] .live-dot {
  background: var(--needs-input);
  animation: rail-dot-pulse 1.4s ease-in-out infinite;
}

[data-status="problem"] .live-dot {
  background: var(--danger);
  animation: rail-dot-pulse 1.4s ease-in-out infinite;
}

[data-status="completed"] .live-dot {
  background: var(--ok);
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
  font: 500 13px/1.35 var(--font-ui);
  text-wrap: pretty;
}

.live-meta {
  margin: 0;
  color: var(--ink-3);
  font: 400 10.5px/1.55 var(--font-ui);
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

[data-status="needs_input"] .live-bar-fill {
  background: var(--needs-input);
  box-shadow: 0 0 10px color-mix(in srgb, var(--needs-input) 60%, transparent);
}

[data-status="problem"] .live-bar-fill {
  background: var(--danger);
  box-shadow: 0 0 10px color-mix(in srgb, var(--danger) 60%, transparent);
}

[data-status="completed"] .live-bar-fill {
  background: var(--ok);
  box-shadow: 0 0 10px color-mix(in srgb, var(--ok) 60%, transparent);
}

.live-bar-label {
  margin: 0;
  color: var(--ink-3);
  font: 400 10px/1.5 var(--font-ui);
}

/* ── The queue/completed pill segment. ── */
.list-tabs {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px;
  border-radius: 999px;
  border: 1px solid var(--hair);
  background: var(--color-neutral-900);
}

.list-tabs-group {
  display: flex;
  flex: 1;
  gap: 3px;
  min-width: 0;
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
  font: 400 11px/1.55 var(--font-ui);
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

.add-task {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  color: var(--ink-3);
  transition:
    background var(--t-fast) var(--ease-out),
    color var(--t-fast) var(--ease-out);
}

.add-task:hover {
  background: var(--row-hover);
  color: var(--ink-1);
}

.create-row {
  padding: 2px 2px 6px;
}

.create-input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid color-mix(in srgb, var(--gold) 40%, transparent);
  border-radius: var(--radius-s);
  background: var(--bg-inset);
  color: var(--ink-1);
  font: 500 12px/1.5 var(--font-ui);
}

.create-input:focus-visible {
  outline: none;
  border-color: var(--gold);
}

/* The counts sit a step behind their label — accent on the selected tab, the
   quietest neutral on the one you are not looking at. */
.list-tab.is-active .tab-count {
  color: var(--color-accent-300);
}

.list-tab:not(.is-active) .tab-count {
  color: var(--color-neutral-700);
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

/* The canvas's row mark is a GLYPH, not a chip — no border, no ground. It is
   still the status control (click cycles), it just stops wearing a box in a
   column of quiet rows. Accent once finished, the quietest neutral while it
   waits; in-progress keeps its own ink. */
.task-row :deep(.status-control) {
  border-color: transparent;
  background: transparent;
}

.task-row:not(.is-done) :deep(.status-control) {
  color: var(--color-neutral-700);
}

.task-row.is-done :deep(.status-control) {
  color: var(--gold);
}

.task-row :deep(.status-control:hover) {
  color: var(--ink-1);
}

.task-title {
  min-width: 0;
  flex: 1;
  text-align: left;
  /* A queued task is something waiting, not the headline — the canvas holds
     the row at neutral-400, well behind the live card above it. */
  color: var(--color-neutral-400);
  font: 400 12px/1.55 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-meta {
  color: var(--ink-3);
  font: 400 10px/1.5 var(--font-ui);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.task-meta.is-live {
  color: var(--gold-bright);
}

/* ── The ACTIVE task — the chat live card's treatment at row scale: a gold
   spine on the row, the dashed status glyph SPINNING as the working signal,
   the title in the working ink, and the current step breathing underneath.
   (Kafi's 2026-08-18 pass: the sub-line breathed while the row read idle —
   the row itself must say "working".) ── */
.task-row.is-live {
  background: color-mix(in srgb, var(--gold) 7%, transparent);
  box-shadow: inset 2px 0 0 var(--gold);
}

.task-row.is-live .task-title {
  color: var(--gold-bright);
}

.task-row.is-live :deep(.status-control) {
  color: var(--gold-bright);
}

.task-row.is-live :deep(.status-control svg) {
  animation: rail-glyph-spin 1.6s linear infinite;
}

@keyframes rail-glyph-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .task-row.is-live :deep(.status-control svg) {
    animation: none;
  }
}

.live-step-line {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 2px 13px;
  padding: 3px 8px 5px 13px;
  border-left: 1px solid color-mix(in srgb, var(--gold) 45%, transparent);
  min-width: 0;
}

.live-step-dot {
  flex: none;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--gold);
  box-shadow: 0 0 7px color-mix(in srgb, var(--gold) 60%, transparent);
  animation: rail-dot-pulse 1.4s ease-in-out infinite;
}

.live-step-title {
  min-width: 0;
  flex: 1;
  color: var(--gold-bright);
  font: 400 11.5px/1.5 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.live-step-count {
  flex: none;
  color: var(--ink-3);
  font: 400 10px/1.5 var(--font-ui);
  font-variant-numeric: tabular-nums;
}

/* ── The step expander — the count is the affordance; the caret confirms. ── */
.step-toggle {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: none;
  padding: 1px 4px;
  border-radius: 999px;
  color: var(--ink-3);
  transition:
    background var(--t-fast) var(--ease-out),
    color var(--t-fast) var(--ease-out);
}

.step-toggle:hover {
  background: var(--row-hover);
  color: var(--ink-1);
}

.step-count {
  font: 400 10px/1.5 var(--font-ui);
  font-variant-numeric: tabular-nums;
}

.step-caret {
  transition: transform var(--t-fast) var(--ease-out);
}

.step-caret.is-open {
  transform: rotate(90deg);
}

.step-list {
  margin: 0 0 2px;
  padding: 2px 0 4px 26px;
  list-style: none;
  display: grid;
  gap: 2px;
  border-left: 1px solid var(--hair);
  margin-left: 13px;
}

.step-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  padding-bottom: 3px;
}

.step-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid var(--hair);
  border-radius: 999px;
  color: var(--ink-3);
  font: 400 10px/1.5 var(--font-ui);
  transition:
    border-color var(--t-fast) var(--ease-out),
    color var(--t-fast) var(--ease-out);
}

.step-action:hover {
  border-color: var(--hair-strong);
  color: var(--ink-1);
}

.step-row {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.step-tick {
  display: grid;
  place-items: center;
  flex: none;
  padding: 1px;
  border-radius: 50%;
}

.step-icon {
  color: var(--ink-3);
}

.step-icon.is-done {
  color: var(--gold);
}

.step-icon.is-live {
  color: var(--gold-bright);
}

.step-tick:hover .step-icon {
  color: var(--ink-1);
}

.step-title {
  min-width: 0;
  flex: 1;
  color: var(--color-neutral-400);
  font: 400 11px/1.55 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.step-title.is-done {
  color: var(--ink-3);
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--ink-3) 55%, transparent);
}

.step-empty {
  color: var(--ink-3);
  font: 400 10.5px/1.5 var(--font-ui);
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
  font: 400 10px/1.5 var(--font-ui);
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
