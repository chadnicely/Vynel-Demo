<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import {
  Activity,
  CalendarClock,
  FolderOpen,
  MessagesSquare,
} from "lucide-vue-next";
import { EmptyState, PresenceDot } from "@vynel/ui";
import LiveNowBand, {
  type LiveTurnRow,
} from "../components/home/LiveNowBand.vue";
import TasksCard from "../components/home/TasksCard.vue";
import UsageStatsCard from "../components/home/UsageStatsCard.vue";
import { narrationLabelFor } from "../components/home/narration-label.js";
import { useDashboardOverview } from "../composables/dashboard/use-dashboard-overview.js";
import { usePendingApprovals } from "../composables/approvals/use-pending-approvals.js";
import { useActivityStore } from "../stores/activity-store.js";
import { useTurnNarrationStore } from "../stores/turn-narration-store.js";
import { useUiStore } from "../stores/ui-store.js";
import { formatRelativeTime } from "../utils/format-relative-time.js";
import { greetingForHour } from "../utils/greeting.js";
import type { SessionTurnOrigin } from "@vynel/contracts/chat/session-activity";

// The dashboard: everything the assistant is doing and holding, one glance.
const router = useRouter();
const ui = useUiStore();
const activity = useActivityStore();
const narration = useTurnNarrationStore();

// Poll while work runs so task completions + fresh sessions land live (the
// SessionsView cadence pattern); quiet otherwise.
const overviewQuery = useDashboardOverview(() =>
  activity.isTurnRunning ? 5000 : false,
);
const overview = computed(() => overviewQuery.data.value ?? null);
const pendingApprovalsQuery = usePendingApprovals();
const pendingCount = computed(
  () => pendingApprovalsQuery.data.value?.length ?? 0,
);

const greeting = greetingForHour(new Date().getHours());

// "Right now": one card per in-flight turn the feed reports, labeled by its
// workspace persona ("Noah · Invoices") or the global thread, narrated by the
// current tool step in plain words.
const ORIGIN_NOTES: Record<SessionTurnOrigin, string | null> = {
  web: null,
  voice: "via Voice",
  telegram: "via Telegram",
  discord: "via Discord",
  zoom: "via Zoom",
  schedule: "from a schedule",
  delegation: "working on a task",
};

const liveNow = computed<LiveTurnRow[]>(() =>
  Object.values(activity.serverTurns).map((turn) => {
    const workspace =
      turn.workspaceId === null
        ? null
        : (overview.value?.workspaces.find(
            (row) => row.id === turn.workspaceId,
          ) ?? null);
    const label = workspace
      ? workspace.managerName
        ? `${workspace.managerName} · ${workspace.name}`
        : workspace.name
      : "Assistant thread";
    return {
      turnId: turn.turnId,
      workspaceId: turn.workspaceId,
      label,
      originNote: ORIGIN_NOTES[turn.origin],
      startedAt: turn.startedAt,
      narration: narrationLabelFor(narration.narrationByTurnId[turn.turnId]?.current),
    };
  }),
);

const statusLine = computed(() => {
  if (liveNow.value.length === 1) return "One session working right now.";
  if (liveNow.value.length > 1)
    return `${liveNow.value.length} sessions working right now.`;
  if (activity.isTurnRunning) return "Your assistant is working right now.";
  if (pendingCount.value > 0)
    return `${pendingCount.value} approval${pendingCount.value === 1 ? "" : "s"} waiting for you.`;
  return "All quiet — everything your assistant does shows up here.";
});

function workspaceNameFor(workspaceId: string | null): string {
  // null = a global-root session on the real wire (no owning workspace).
  if (workspaceId === null) return "Global chat";
  return (
    overview.value?.workspaces.find((row) => row.id === workspaceId)?.name ??
    "Workspace"
  );
}

function openSession(workspaceId: string | null) {
  if (workspaceId === null) {
    void router.push({ name: "chat" });
    return;
  }
  ui.openWorkspaceTab(workspaceId);
  void router.push({ name: "workspace" });
}

function openWorkspace(workspaceId: string) {
  ui.openWorkspaceTab(workspaceId);
  void router.push({ name: "workspace" });
}

// In-progress work leads the tasks card — it's what the assistant has in hand.
const openTasks = computed(() => {
  const rows = overview.value?.openTasks ?? [];
  return [
    ...rows.filter((row) => row.status === "in-progress"),
    ...rows.filter((row) => row.status !== "in-progress"),
  ];
});
const recentlyCompletedTasks = computed(
  () => overview.value?.recentlyCompletedTasks ?? [],
);

function scheduleTiming(nextFireAt: string | null): string {
  if (!nextFireAt) return "not scheduled";
  return new Date(nextFireAt).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}
</script>

<template>
  <div class="home-view">
    <header class="home-header">
      <h1 class="greeting">{{ greeting }}</h1>
      <p class="status-line">
        <PresenceDot
          :state="
            activity.isTurnRunning
              ? 'live'
              : pendingCount > 0
                ? 'attention'
                : 'idle'
          "
        />
        {{ statusLine }}
      </p>
    </header>

    <Transition name="live-band">
      <LiveNowBand
        v-if="liveNow.length > 0"
        :turns="liveNow"
        @open="openSession"
      />
    </Transition>

    <div class="card-grid">
      <section class="card span-2">
        <header class="card-header">
          <MessagesSquare :size="14" class="card-icon" />
          <p class="card-title">Recent conversations</p>
        </header>
        <EmptyState
          v-if="(overview?.recentSessions.length ?? 0) === 0"
          title="Nothing yet"
          hint="Start in Chat — every conversation lands here."
        />
        <button
          v-for="session in overview?.recentSessions ?? []"
          :key="session.id"
          type="button"
          class="list-row"
          @click="openSession(session.workspaceId)"
        >
          <span class="row-title">{{ session.title }}</span>
          <span v-if="session.lastMessagePreview" class="row-sub">
            {{ session.lastMessagePreview }}
          </span>
          <span class="row-meta">
            {{ workspaceNameFor(session.workspaceId) }} ·
            {{ formatRelativeTime(session.lastMessageAt) }}
          </span>
        </button>
      </section>

      <section class="card">
        <header class="card-header">
          <FolderOpen :size="14" class="card-icon" />
          <p class="card-title">Workspaces</p>
        </header>
        <button
          v-for="workspace in overview?.workspaces ?? []"
          :key="workspace.id"
          type="button"
          class="list-row"
          @click="openWorkspace(workspace.id)"
        >
          <span class="row-title">{{ workspace.name }}</span>
          <span class="row-meta">
            {{
              workspace.managerName
                ? `${workspace.managerName} is handling it`
                : "No manager assigned yet"
            }}
          </span>
        </button>
      </section>

      <section class="card">
        <header class="card-header">
          <CalendarClock :size="14" class="card-icon" />
          <p class="card-title">Coming up</p>
        </header>
        <EmptyState
          v-if="(overview?.upcomingSchedules.length ?? 0) === 0"
          title="No schedules yet"
          hint="Ask for a morning briefing or a reminder."
        />
        <div
          v-for="schedule in overview?.upcomingSchedules ?? []"
          :key="schedule.id"
          class="list-row is-static"
        >
          <span class="row-title">{{ schedule.displayName }}</span>
          <span class="row-meta">
            {{ scheduleTiming(schedule.nextScheduledFireAt) }} ·
            {{ schedule.scheduleKind === "one-time" ? "one time" : "repeats" }}
          </span>
        </div>
      </section>

      <TasksCard
        :open-tasks="openTasks"
        :completed-tasks="recentlyCompletedTasks"
      />

      <UsageStatsCard />

      <section class="card span-2">
        <header class="card-header">
          <Activity :size="14" class="card-icon" />
          <p class="card-title">Approvals</p>
        </header>
        <p class="card-note">
          {{
            pendingCount > 0
              ? `${pendingCount} waiting — they also pop up in the corner of any screen.`
              : "Nothing needs your sign-off right now. When something does, it appears here and in the corner of any screen."
          }}
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.home-view {
  height: 100%;
  overflow-y: auto;
  padding: 44px 32px;
  max-width: 960px;
  margin: 0 auto;
}

.home-header {
  margin-bottom: 22px;
}

.greeting {
  margin: 0;
  color: var(--ink-1);
  font: 600 28px/1.3 var(--font-ui);
  letter-spacing: -0.01em;
}

.status-line {
  margin: 6px 0 0;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ink-2);
  font: 400 13.5px/1.6 var(--font-ui);
}

.card-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

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

.card-note {
  margin: 0;
  color: var(--ink-2);
  font: 400 12.5px/1.6 var(--font-ui);
}

.list-row {
  appearance: none;
  border: 0;
  margin: 0;
  display: grid;
  gap: 1px;
  padding: 7px 8px;
  border-radius: var(--radius-s);
  background: transparent;
  text-align: left;
  cursor: default;
}

.list-row:not(.is-static):hover {
  background: var(--row-hover);
}

.list-row:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: -2px;
}

.row-title {
  color: var(--ink-1);
  font: 500 12.5px/1.5 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-sub {
  color: var(--ink-3);
  font: 400 11.5px/1.5 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-meta {
  color: var(--ink-3);
  font: 400 10.5px/1.5 var(--font-ui);
}

/* The "Right now" band breathes in and collapses out with the work. */
.live-band-enter-active {
  transition:
    opacity 0.24s var(--ease-out, ease-out),
    transform 0.24s var(--ease-out, ease-out);
}

.live-band-leave-active {
  transition: opacity 0.2s var(--ease-out, ease-out);
}

.live-band-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.live-band-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .live-band-enter-active,
  .live-band-leave-active {
    transition: none;
  }
}

@media (max-width: 860px) {
  .card-grid {
    grid-template-columns: 1fr;
  }

  .span-2 {
    grid-column: span 1;
  }
}
</style>
