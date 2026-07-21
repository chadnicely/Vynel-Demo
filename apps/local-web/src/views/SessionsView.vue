<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { History } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import type {
  SessionsOverviewEntry,
  SessionsOverviewSegment,
} from "@vynel/contracts/chat/sessions-overview";
import { useSessionsOverview } from "../composables/sessions/use-sessions-overview.js";
import { useWorkspaceList } from "../composables/workspaces/use-workspace-list.js";
import { useActivityStore } from "../stores/activity-store.js";
import { useActivityMonitorStore } from "../stores/activity-monitor-store.js";
import { useUiStore } from "../stores/ui-store.js";
import { formatSdkError } from "../utils/format-sdk-error.js";
import SectionHeader from "../components/sections/SectionHeader.vue";
import SessionRow from "../components/sessions/SessionRow.vue";
import SessionThreadView from "../components/sessions/SessionThreadView.vue";
import { sessionScopeLabel } from "../components/sessions/session-scope-label.js";

// The Sessions view — the routed session library (Home | Chat | Sessions).
// Lists every session in the CURRENT scope, newest first: in a workspace
// (`?workspace=<id>`) the room's primary chain + its spawned children; in
// global, everything. Opening an entry:
//   - a spawned session → the full thread view, directly chattable (head);
//   - a chain part that was superseded → the thread view, read-only
//     (locked decision 2 — chat always lands on the head);
//   - a global/workspace PRIMARY → its chat IS the Chat nav; navigate there.
const route = useRoute();
const router = useRouter();
const ui = useUiStore();
const activity = useActivityStore();
const activityMonitor = useActivityMonitorStore();

const workspaceScopeId = computed(() =>
  typeof route.query.workspace === "string" ? route.query.workspace : null,
);

const workspacesQuery = useWorkspaceList();
const scopeWorkspaceName = computed(
  () =>
    (workspacesQuery.data.value ?? []).find(
      (workspace) => workspace.id === workspaceScopeId.value,
    )?.name ?? null,
);

const overviewQuery = useSessionsOverview(true, () =>
  activity.isTurnRunning ? 5000 : false,
);

const entries = computed<SessionsOverviewEntry[]>(() => {
  const all = overviewQuery.data.value ?? [];
  const scopeId = workspaceScopeId.value;
  if (scopeId === null) return all;
  // The room's own sessions: its primary chain and the spawned sessions
  // grounded in it — both carry the workspace id on their overview entry.
  return all.filter((entry) => entry.workspaceId === scopeId);
});

const errorText = computed(() =>
  overviewQuery.isError.value
    ? formatSdkError(overviewQuery.error.value)
    : null,
);

const subtitle = computed(() =>
  workspaceScopeId.value === null
    ? "Every conversation, how much room it has left, and what's running now"
    : `Everything running in ${scopeWorkspaceName.value ?? "this workspace"} — its conversation and its sessions`,
);

function isWorking(entry: SessionsOverviewEntry): boolean {
  if (entry.scope === "global") return activity.hasGlobalServerTurn;
  if (entry.scope === "workspace" && entry.workspaceId !== null)
    return activity.hasServerTurnInWorkspace(entry.workspaceId);
  return false;
}

// ── Opening ────────────────────────────────────────────────────────
interface OpenThread {
  sessionId: string;
  title: string;
  chattable: boolean;
  viewOnlyNote: string | null;
}

const openThread = ref<OpenThread | null>(null);

// A scope switch (the nav, the workspace switcher) returns to the list — a
// thread from another scope must not linger over the new one.
watch(workspaceScopeId, () => {
  openThread.value = null;
});

function primaryViewOnlyNote(entry: SessionsOverviewEntry): string {
  return entry.scope === "global"
    ? "This part of the conversation was continued — chat carries on in Chat."
    : "This part of the conversation was continued — chat carries on in this workspace's Chat.";
}

function openEntry(entry: SessionsOverviewEntry) {
  if (entry.scope === "global") {
    // The brain's chat IS the Chat nav — no second composer onto one thread.
    ui.globalChat.target = "continuous";
    ui.globalChat.mainView = "chat";
    void router.push({ name: "chat" });
    return;
  }
  if (entry.scope === "workspace") {
    if (entry.workspaceId !== null) ui.activeWorkspaceId = entry.workspaceId;
    ui.workspaceChat.target = "continuous";
    ui.workspaceChat.mainView = "chat";
    void router.push({ name: "workspace" });
    return;
  }
  openThread.value = {
    sessionId: entry.sessionId,
    title: entry.title,
    // Spawned sessions chat directly at their head; an agent-scope transcript
    // has no turn surface — read-only.
    chattable: entry.scope === "spawned",
    viewOnlyNote:
      entry.scope === "spawned"
        ? null
        : "This session ran on its own — there's nothing to send it here.",
  };
}

function openSegment(
  entry: SessionsOverviewEntry,
  segment: SessionsOverviewSegment,
) {
  // The head is the entry's own open target; only superseded parts differ.
  if (segment.sessionId === entry.sessionId) {
    openEntry(entry);
    return;
  }
  openThread.value = {
    sessionId: segment.sessionId,
    title: `${entry.title} · earlier part`,
    chattable: false,
    viewOnlyNote:
      entry.scope === "spawned" || entry.scope === "agent"
        ? "This part of the conversation was continued — chat carries on at the newest part."
        : primaryViewOnlyNote(entry),
  };
}

function openWatch(entry: SessionsOverviewEntry) {
  activityMonitor.openSession(
    entry.sessionId,
    `${sessionScopeLabel(entry)} · ${entry.title}`,
  );
}
</script>

<template>
  <SessionThreadView
    v-if="openThread"
    :session-id="openThread.sessionId"
    :title="openThread.title"
    :chattable="openThread.chattable"
    :view-only-note="openThread.viewOnlyNote"
    @back="openThread = null"
  />

  <div v-else class="sessions-view">
    <div class="sessions-column flex flex-col gap-2.5">
      <SectionHeader :icon="History" title="Sessions" :subtitle="subtitle" />

      <p
        v-if="overviewQuery.isPending.value"
        class="state-note m-0 text-center text-xs text-ink-3"
      >
        Loading conversations…
      </p>

      <p
        v-else-if="errorText"
        class="error-note m-0 text-center text-xs text-danger"
      >
        {{ errorText }}
      </p>

      <EmptyState
        v-else-if="entries.length === 0"
        title="No conversations yet"
        hint="Start talking to Claude and every conversation shows up here."
      >
        <template #icon>
          <History :size="22" />
        </template>
      </EmptyState>

      <div v-else class="rows flex flex-col gap-2">
        <SessionRow
          v-for="entry in entries"
          :key="entry.sessionId"
          :entry="entry"
          :is-working="isWorking(entry)"
          @open="openEntry(entry)"
          @open-segment="(segment) => openSegment(entry, segment)"
          @watch="openWatch(entry)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.sessions-view {
  height: 100%;
  overflow-y: auto;
  background: var(--bg-shell);
}

.sessions-column {
  max-width: 760px;
  margin: 0 auto;
  padding: 44px 40px;
}
</style>
