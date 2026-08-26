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
  PhCircleNotch as CircleNotch,
  PhMonitor as Monitor,
  PhPlus as Plus,
  PhTrash as Trash,
} from "@phosphor-icons/vue";
import { ConfirmButton, EmptyState } from "@vynel/ui";
import type { TaskResponse, TaskStatus } from "@vynel/contracts/tasks/task-http";
import type { TaskStepStatus } from "@vynel/contracts/tasks/task-step-http";
import { useCreateTask } from "../../composables/tasks/use-create-task.js";
import { useDeleteTask } from "../../composables/tasks/use-delete-task.js";
import { useTasksInScope } from "../../composables/tasks/use-tasks-in-scope.js";
import { useUpdateTask } from "../../composables/tasks/use-update-task.js";
import { useTaskSteps } from "../../composables/tasks/use-task-steps.js";
import { useUpdateStepStatus } from "../../composables/tasks/use-update-step-status.js";
import { usePlanForTask } from "../../composables/plans/use-plan-for-task.js";
import { useSessionsOverview } from "../../composables/sessions/use-sessions-overview.js";
import { matchTurnToIdentity } from "../../composables/activity/match-turn-to-identity.js";
import TaskViewDialog from "./TaskViewDialog.vue";
import LiveStepLine from "./LiveStepLine.vue";
import SessionIconBadge from "../sessions/SessionIconBadge.vue";
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
    /** What you typed while it was working, newest last. It belongs HERE, in
     *  the live card, not only in a chip row above the composer (Chad,
     *  2026-08-25) — the card is where the current work lives, so what you
     *  said to it while it ran belongs in the same box. */
    saidWhileWorking?: readonly string[];
  }>(),
  { saidWhileWorking: () => [] },
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

// ALL tasks in one list (Chad, 2026-08-25): completed work floats to the
// TOP, kept struck, then the live task, then the queued ones — finished work
// stacks up visibly instead of hiding behind a tab. The sort is stable and
// each task keeps the number of its original place, so the card's "Task N"
// still points at row N.
const STAGE_ORDER: Record<TaskStatus, number> = { done: 0, "in-progress": 1, open: 2 };
const shownTasks = computed(() =>
  [...tasksInScope.value].sort((a, b) => STAGE_ORDER[a.status] - STAGE_ORDER[b.status]),
);
function numberOf(task: TaskResponse): number {
  return tasksInScope.value.indexOf(task) + 1;
}

// The turns anchoring the live card + interrupt, as before: for a WORKSPACE,
// the room's own thread alone (matchTurnToIdentity's workspace identity
// deliberately excludes the children — a spawned session announces in the
// room's scope but names its own continuing identity); for GLOBAL, the whole
// area family, the matcher's documented asymmetry.
const workingTurns = computed(() =>
  Object.values(activity.serverTurns).filter((turn) =>
    matchTurnToIdentity(
      turn,
      scopeWorkspaceId.value === null
        ? { kind: "global" }
        : { kind: "workspace", workspaceId: scopeWorkspaceId.value },
    ),
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

// The sessions box — the scope's working CHILD sessions (the user's call,
// 2026-08-24): only sessions spawned for this workspace, by name and icon,
// never the primary — the room's own thread already owns the live card and
// the workspace header. Rows resolve through the shared overview (warm on
// these surfaces via the context-occupancy read, so the count is live while
// the box is folded); a turn the overview can't name yet simply waits a
// beat. Always scope-filtered — the standing rule for every session surface.
//
// A turn is placed by its RESOLVED conversation, never by the frame's area
// stamp: the two doors into one child disagree on the wire — a delegated
// send_message turn announces in the GLOBAL family with no workspaceId
// (run-task-job's session-target rule, from before children could be
// workspace-grounded) while an interactive turn announces in the room — so
// filtering on `scopeKind` showed "0 sessions working" while a child worked.
// The session ROW is the one truth for where a child belongs; the voice
// thread excludes itself here too (its entry's scope is 'voice').
const isSessionsBoxOpen = ref(false);
const sessionsOverviewQuery = useSessionsOverview(true);
const workingChildSessions = computed(() => {
  const entries = sessionsOverviewQuery.data.value ?? [];
  const rows: { sessionId: string; title: string; icon: string | null }[] = [];
  // Dedupe on the CONVERSATION (the entry's head) — two frames of one child
  // must render one row, never duplicate keys.
  const seenConversationIds = new Set<string>();
  for (const turn of Object.values(activity.serverTurns)) {
    // The continuing identity first (the feed stamps it before the turn
    // resolves a session id), then the served segment.
    const entry =
      entries.find(
        (row) =>
          turn.primarySessionId != null &&
          row.primarySessionId === turn.primarySessionId,
      ) ??
      entries.find(
        (row) =>
          turn.sessionId !== null &&
          (row.sessionId === turn.sessionId ||
            row.segments.some((segment) => segment.sessionId === turn.sessionId)),
      );
    // Children of THIS scope only: a spawned or agent conversation grounded
    // here (global children carry a null workspaceId, matching the global
    // panel's null scope id). The room's own thread (scope 'workspace') and
    // the brain (scope 'global') stay out.
    if (entry === undefined || (entry.scope !== "spawned" && entry.scope !== "agent"))
      continue;
    if (entry.workspaceId !== scopeWorkspaceId.value) continue;
    if (seenConversationIds.has(entry.sessionId)) continue;
    seenConversationIds.add(entry.sessionId);
    rows.push({
      sessionId: turn.sessionId ?? entry.sessionId,
      title: entry.title,
      icon: entry.icon,
    });
  }
  return rows;
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

// The card is LIT while the task is unresolved, not only while a turn
// streams (Chad, 2026-08-25): tied to the stream it went quiet between turns
// on plainly unfinished work. The status dot still says whether it is moving
// right now.
const isLit = computed(() => liveTask.value !== null);

// What the card HEADLINES: the task being worked; while a turn runs with
// nothing marked in-progress yet, the next queued one — the card still names
// what's up (Chad's rule). Idle with a queue is NOT headlined: that would
// read "building now" over work nobody is doing.
const headlineTask = computed(
  () =>
    liveTask.value ??
    (scopeStatus.value === "running" ? (queuedTasks.value[0] ?? null) : null),
);

// Chad's kicker vocabulary — one line per state.
const liveKicker = computed(() => {
  if (scopeStatus.value === "needs_input") return "Wants your feedback";
  if (scopeStatus.value === "problem") return "Hit a problem";
  if (scopeStatus.value === "completed") return "All done";
  if (scopeStatus.value === "running" || isLit.value) return "Working on now";
  return "Not running";
});
const liveTitle = computed(() => {
  if (headlineTask.value !== null) return headlineTask.value.title;
  if (scopeStatus.value === "running") return "Working in the chat";
  if (scopeStatus.value === "needs_input") return "Something needs your answer";
  if (scopeStatus.value === "problem") return "Stopped on an error";
  if (scopeStatus.value === "completed") return "Everything on the list is done";
  return "Nothing running";
});
const liveMeta = computed(() => {
  // The assistant's own one-line why (set_workspace_status note) wins.
  const note = statusView.value?.note;
  if (note) return note;
  // "Task 2 · building now" — the headlined task by its number (Chad, 2026-08-25).
  if (headlineTask.value !== null) {
    const stage = scopeStatus.value === "needs_input" ? "waiting on you" : "building now";
    return `Task ${numberOf(headlineTask.value)} · ${stage}`;
  }
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
  // Every other state reads the task rollup (Chad's "N of M tasks done");
  // while a turn runs with steps, the step bar takes the slot instead.
  return `${view.tasksDone} of ${view.tasksTotal} tasks done`;
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

// THE KILL SWITCH — pinned at the top, no confirm (Chad, 2026-08-25: "it
// needs to stop IMMEDIATELY, no delay"). Stops THIS scope's running turn;
// other rooms keep going. A workspace room interrupts its own session; the
// Global rail stops the global turn by identity — the same two doors the
// composer's Stop uses, so the red button is never a dead press.
const canAbort = computed(() => liveSessionId.value !== null);
const isInterrupting = ref(false);
async function abortLiveSession() {
  const sessionId = liveSessionId.value;
  if (isInterrupting.value || sessionId === null) return;
  isInterrupting.value = true;
  try {
    if (props.scope.kind === "workspace") {
      await vynel.chat.interruptSession(props.scope.workspaceId, sessionId);
    } else {
      await vynel.root.interruptTurn({ sessionId });
    }
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

// Delete from the row (Kafi, 2026-08-22): a compact arm-then-confirm trash
// that appears on hover, just before the step caret — the same two clicks
// the sections use, on the queue's footprint.
const deleteTask = useDeleteTask();
function removeTask(task: TaskResponse) {
  deleteTask.mutate(
    { taskId: task.id },
    // Fold only once it is really gone — a failed delete keeps the row, and
    // its open steps, exactly as they were.
    {
      onSuccess: () => {
        if (expandedTaskId.value === task.id) expandedTaskId.value = null;
      },
    },
  );
}

// The expanded task's PLAN + SESSION doors (the sketch's icon row): the plan
// icon opens the shared review dialog on either relation (the day-plan link
// or the execution plan whose taskId points here); the session icon opens the
// ASSIGNED session's real conversation in the sidebar — the same door the
// sessions box's rows open (Kafi, 2026-08-18: never the sessions tab).
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
// EVERY in-progress task with a plan wears its current-step sub-line (Kafi,
// 2026-08-22 — not only the first); a task with no steps keeps the plain
// "now" on its row, and an expanded task shows the full list instead.
function showsLiveSubline(task: TaskResponse): boolean {
  return (
    task.status === "in-progress" &&
    expandedTaskId.value !== task.id &&
    stepCountLabel(task) !== null
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
    <!-- THE KILL SWITCH — at the top where the eye lands, no confirm (Chad,
         2026-08-25). Stops THIS scope's work; other rooms keep going.
         Disabled, never hidden, while nothing runs: a button that vanishes
         reads as a bug, a dead press reads as a broken one. -->
    <button
      type="button"
      class="abort-btn"
      :disabled="!canAbort || isInterrupting"
      :title="canAbort ? 'Stop this project\'s work — other projects keep going' : 'Nothing running to stop'"
      @click="abortLiveSession"
    >
      <span class="abort-square" aria-hidden="true" />ABORT
    </button>

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
        <span class="activity-count">{{ workingChildSessions.length }}</span>
        {{ workingChildSessions.length === 1 ? "session" : "sessions" }} working
        <CaretRight
          :size="10"
          class="sessions-caret"
          :class="{ 'is-open': isSessionsBoxOpen }"
        />
      </button>
      <ul v-if="isSessionsBoxOpen" class="sessions-list">
        <!-- The workspace tree's row language, per child session: its face
             (curated icon, else monogram), its name, the working spinner.
             Clicking opens the session's REAL conversation in the sidebar. -->
        <li v-for="session in workingChildSessions" :key="session.sessionId">
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
            <SessionIconBadge :name="session.title" :icon="session.icon" />
            <span class="sessions-title">{{ session.title }}</span>
            <CircleNotch
              :size="13"
              weight="bold"
              class="sessions-spinner"
              aria-label="Working"
            />
          </button>
        </li>
        <li v-if="workingChildSessions.length === 0" class="sessions-empty">
          Nothing working right now.
        </li>
      </ul>
    </header>

    <!-- The live card — the scope's status, what's being worked, and the
         real numbers: session steps while running, the task rollup in the
         end states. One status, one colour. -->
    <div class="live-card" :class="{ 'is-lit': isLit }" :data-status="scopeStatus">
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

      <!-- What you said to it while it was working, in the same box as the
           work itself. Newest last, so it reads as a conversation. -->
      <ul v-if="props.saidWhileWorking.length > 0" class="live-said">
        <li v-for="(line, index) in props.saidWhileWorking" :key="index">
          {{ line }}
        </li>
      </ul>
    </div>

    <!-- ALL TASKS — one list, done work struck at the top (Chad); the add
         button keeps its place beside the label. -->
    <div class="list-head">
      <p class="list-label">All Tasks</p>
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
        title="Nothing on the list"
        hint="Ask for something and it'll track the steps here."
      />

      <template v-for="task in shownTasks" :key="task.id">
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
            {{ numberOf(task) }}. {{ task.title }}
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
          <!-- Delete, on hover, just before the caret: arm, then confirm. -->
          <ConfirmButton
            class="task-delete"
            compact
            danger
            label="Delete task"
            confirm-label="Delete?"
            :busy="deleteTask.isPending.value && deleteTask.variables.value?.taskId === task.id"
            @confirm="removeTask(task)"
          >
            <template #icon><Trash :size="11" /></template>
          </ConfirmButton>
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
             being worked RIGHT NOW breathes under EVERY in-progress task's
             collapsed row; expanding replaces it with the full list. -->
        <LiveStepLine
          v-if="showsLiveSubline(task)"
          :task-id="task.id"
          :count-label="stepCountLabel(task)"
        />
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
  /* ABORT · header · card · list head · the list (stretches) · open it */
  grid-template-rows: auto auto auto auto 1fr auto;
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

/* The workspace tree's row footprint, per child session: 30px row, the 18px
   face, the name, the working spinner closing the row. */
.sessions-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  min-height: 30px;
  padding: 2px 9px 2px 6px;
  border-radius: var(--radius-s);
  text-align: left;
  transition: background var(--t-fast) var(--ease-out);
}

.sessions-row:hover {
  background: var(--row-hover);
}

.sessions-title {
  flex: 1;
  min-width: 0;
  color: var(--ink-2);
  font: 400 12.5px/1.5 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sessions-row:hover .sessions-title {
  color: var(--ink-1);
}

/* Gold = presence: every row here IS a running turn. */
.sessions-spinner {
  flex: none;
  color: var(--gold);
  animation: sessions-spinner-turn 1.6s linear infinite;
}

@keyframes sessions-spinner-turn {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .sessions-spinner {
    animation: none;
  }
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

/* The trash shows itself only when the row is hovered or holds focus, and
   stays while armed — a destructive control never sits in plain view on a
   list you scan. `visibility` keeps it out of the tab order until then. */
.task-delete {
  flex: none;
  opacity: 0;
  visibility: hidden;
  transition: opacity var(--t-fast) var(--ease-out);
}
.task-row:hover .task-delete,
.task-row:focus-within .task-delete,
.task-delete[aria-pressed="true"] {
  opacity: 1;
  visibility: visible;
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

/* ── The kill switch (Chad, 2026-08-25) — red, pinned at the top. Disabled,
   never hidden, while nothing runs. ── */
.abort-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--danger);
  border-radius: 8px;
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
  font: 700 11.5px/1.4 var(--font-ui);
  letter-spacing: 0.08em;
  cursor: default;
  transition: background var(--t-fast) var(--ease-out);
}

.abort-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger) 24%, transparent);
}

.abort-btn:disabled {
  opacity: 0.45;
}

.abort-square {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  background: var(--danger);
}

/* Lit while the task is unresolved, not only while a turn streams. */
.live-card.is-lit {
  animation: live-card-breathe 1.8s ease-in-out infinite;
}

@keyframes live-card-breathe {
  0%,
  100% {
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--gold) 35%, transparent);
  }
  50% {
    box-shadow:
      0 0 0 1px var(--gold),
      0 0 16px -4px var(--gold);
  }
}

@media (prefers-reduced-motion: reduce) {
  .live-card.is-lit {
    animation: none;
  }
}

/* What you said while it worked — quiet rows inside the card, one line
   each, clipped so a paragraph cannot push the task out of view. */
.live-said {
  list-style: none;
  margin: 4px 0 0;
  padding: 6px 0 0;
  border-top: 1px solid var(--hair);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.live-said li {
  color: var(--ink-2);
  font-size: 11.5px;
  line-height: 1.45;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ALL TASKS — the one list's head. */
.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.list-label {
  margin: 0;
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-3);
}

/* Done work stays in the list, struck and dimmed. */
.task-row.is-done .task-title {
  text-decoration: line-through;
  opacity: 0.6;
}
</style>
