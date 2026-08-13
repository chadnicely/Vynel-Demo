<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { PhClockCounterClockwise as History } from "@phosphor-icons/vue";
import { EmptyState } from "@vynel/ui";
import type {
  SessionsOverviewEntry,
  SessionsOverviewSegment,
} from "@vynel/contracts/chat/sessions-overview";
import { useSessionsOverview } from "../composables/sessions/use-sessions-overview.js";
import { sessionOpenAffordance } from "../composables/sessions/session-open-affordance.js";
import { useActivityStore } from "../stores/activity-store.js";
import { useUiStore } from "../stores/ui-store.js";
import { formatSdkError } from "../utils/format-sdk-error.js";
import SessionRow from "../components/sessions/SessionRow.vue";
import SessionThreadView from "../components/sessions/SessionThreadView.vue";

// The Sessions view (Home | Chat | Sessions) — the OLD Conversations-panel
// shape, kept simple (Chad): a narrow list of plain rows beside the canvas,
// and the selected session opened as a normal chat. Scope:
//   - global — ONLY the global root's own child sessions (spawned,
//     workspace-less); workspace sessions live in their room, and the brain's
//     own thread IS the Chat nav.
//   - a workspace (`?workspace=<id>`) — the room's conversation + its sessions.
// Opening: a spawned session chats directly at its head; a superseded chain
// part is view-only (locked decision 2); a primary routes to its Chat.
const route = useRoute();
const router = useRouter();
const ui = useUiStore();
const activity = useActivityStore();

const workspaceScopeId = computed(() =>
  typeof route.query.workspace === "string" ? route.query.workspace : null,
);

const overviewQuery = useSessionsOverview(true, () =>
  activity.isTurnRunning ? 5000 : false,
);

const entries = computed<SessionsOverviewEntry[]>(() => {
  const all = overviewQuery.data.value ?? [];
  const scopeId = workspaceScopeId.value;
  if (scopeId !== null) {
    // The room's own sessions: its primary chain and the spawned sessions
    // grounded in it — both carry the workspace id on their overview entry.
    return all.filter((entry) => entry.workspaceId === scopeId);
  }
  // Global: only the root's own children. The Assistant thread is the Chat
  // nav; workspace conversations belong to their rooms.
  return all.filter(
    (entry) => entry.scope === "spawned" && entry.workspaceId === null,
  );
});

const errorText = computed(() =>
  overviewQuery.isError.value
    ? formatSdkError(overviewQuery.error.value)
    : null,
);

/** A turn running in this entry's session right now: its room's turn for the
 *  workspace conversation, or (any scope) a server turn on one of the entry's
 *  chain segments — how a spawned session's delegated task lights the dot. */
function isWorking(entry: SessionsOverviewEntry): boolean {
  if (
    entry.scope === "workspace" &&
    entry.workspaceId !== null &&
    activity.hasServerTurnInWorkspace(entry.workspaceId)
  ) {
    return true;
  }
  const segmentIds = new Set(entry.segments.map((segment) => segment.sessionId));
  return Object.values(activity.serverTurns).some(
    (turn) => turn.sessionId !== null && segmentIds.has(turn.sessionId),
  );
}

// ── Opening ────────────────────────────────────────────────────────
interface OpenThread {
  sessionId: string;
  title: string;
  chattable: boolean;
  viewOnlyNote: string | null;
  /** Head opens follow the chain onto a fresh segment live (B6); a
   *  deliberately-opened earlier part stays put. */
  followChain: boolean;
}

const openThread = ref<OpenThread | null>(null);

// A scope switch (the nav, the workspace switcher) returns to the list — a
// thread from another scope must not linger over the new one.
watch(workspaceScopeId, () => {
  openThread.value = null;
});

// No 'global' branch: the filters above keep the brain's thread off this list
// entirely (its chat IS the Chat nav) — only rooms and spawned/agent sessions
// can arrive here.
function openEntry(entry: SessionsOverviewEntry) {
  if (entry.scope === "workspace") {
    // Focus (or open) the room's tab — landing on its chat, keeping the
    // conversation the tab was already on.
    if (entry.workspaceId !== null) ui.openWorkspaceTab(entry.workspaceId);
    void router.push({ name: "workspace" });
    return;
  }
  // The direct-send rule + view-only wording live in ONE home shared with the
  // monitor's live pane (session-open-affordance.ts).
  openThread.value = {
    sessionId: entry.sessionId,
    title: entry.title,
    ...sessionOpenAffordance(entry.scope),
    followChain: true,
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
      entry.scope === "workspace"
        ? "This part of the conversation was continued — chat carries on in this workspace's Chat."
        : "This part of the conversation was continued — chat carries on at the newest part.",
    // The user asked for THIS part — never re-resolve it to the head.
    followChain: false,
  };
}
</script>

<template>
  <div class="sessions-view">
    <aside class="sessions-list">
      <header class="panel-header">
        <p class="panel-title">Sessions</p>
      </header>

      <div class="list-body">
        <p v-if="overviewQuery.isPending.value" class="state-note">
          Loading conversations…
        </p>

        <p v-else-if="errorText" class="error-note">{{ errorText }}</p>

        <p v-else-if="entries.length === 0" class="state-note">
          No conversations yet — sessions you spin up land here.
        </p>

        <template v-else>
          <SessionRow
            v-for="entry in entries"
            :key="entry.sessionId"
            :entry="entry"
            :is-active="openThread?.sessionId === entry.sessionId"
            :is-working="isWorking(entry)"
            @open="openEntry(entry)"
            @open-segment="(segment) => openSegment(entry, segment)"
          />
        </template>
      </div>
    </aside>

    <main class="session-pane">
      <SessionThreadView
        v-if="openThread"
        :key="openThread.sessionId"
        :session-id="openThread.sessionId"
        :title="openThread.title"
        :chattable="openThread.chattable"
        :view-only-note="openThread.viewOnlyNote"
        :follow-chain="openThread.followChain"
      />
      <div v-else class="pane-empty">
        <EmptyState
          title="Pick a session"
          hint="Open one from the list to read it — and talk to it right there."
        >
          <template #icon>
            <History :size="22" />
          </template>
        </EmptyState>
      </div>
    </main>
  </div>
</template>

<style scoped>
.sessions-view {
  height: 100%;
  display: flex;
  min-height: 0;
  background: var(--bg-shell);
}

/* The old Conversations-panel shape: a narrow plain list beside the canvas. */
.sessions-list {
  display: grid;
  grid-template-rows: auto 1fr;
  min-height: 0;
  width: 280px;
  flex: none;
  background: var(--bg-panel);
  border-right: 1px solid var(--hair);
}

.panel-header {
  display: flex;
  align-items: center;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--hair);
}

.panel-title {
  margin: 0;
  color: var(--ink-2);
  font: 600 12px/1.5 var(--font-ui);
}

.list-body {
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.state-note {
  margin: 16px 8px 0;
  text-align: center;
  color: var(--ink-3);
  font: 400 12px/1.5 var(--font-ui);
}

.error-note {
  margin: 16px 8px 0;
  text-align: center;
  color: var(--danger);
  font: 400 12px/1.5 var(--font-ui);
}

.session-pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.pane-empty {
  height: 100%;
  display: grid;
  place-items: center;
}
</style>
