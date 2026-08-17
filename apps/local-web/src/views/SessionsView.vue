<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { PhClockCounterClockwise as History } from "@phosphor-icons/vue";
import { EmptyState } from "@vynel/ui";
import type {
  SessionsOverviewEntry,
  SessionsOverviewSegment,
} from "@vynel/contracts/chat/sessions-overview";
import { useSessionsLibrary } from "../composables/sessions/use-sessions-library.js";
import { useSessionStatuses } from "../composables/sessions/use-session-statuses.js";
import { sessionOpenAffordance } from "../composables/sessions/session-open-affordance.js";
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

const workspaceScopeId = computed(() =>
  typeof route.query.workspace === "string" ? route.query.workspace : null,
);

// PAGED (2026-08-17): the library used to take the shared capped read and
// filter it here, which meant it showed the newest 50 conversations and said
// nothing about the rest — older ones were simply unreachable. The scope now
// curates server-side so each page is dense, and the sentinel below asks for
// the next one as it comes into view.
const { query: libraryQuery, entries } = useSessionsLibrary(workspaceScopeId);

const errorText = computed(() =>
  libraryQuery.isError.value
    ? formatSdkError(libraryQuery.error.value)
    : null,
);

// Each row's status light — the ONE derivation every surface reads (the live
// turn that used to be this view's private `isWorking` is now one fact inside
// it, alongside pending approvals, the assistant's set state, and the last
// turn's error). Fed THIS view's pages, so a conversation scrolled in on page
// three lights up like any other; the shared overview only knows the first 50.
const sessionStatuses = useSessionStatuses(entries);

// ── Infinite scroll ────────────────────────────────────────────────
// An IntersectionObserver on a sentinel under the last row, rather than a
// scroll listener: it fires once when the row enters, costs nothing while
// idle, and needs no scroll maths. A turn running elsewhere re-fetches the
// pages already loaded (vue-query), so the list stays live without polling
// its way to the end.
const sentinel = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

watch(sentinel, (element) => {
  observer?.disconnect();
  observer = null;
  if (element === null) return;
  observer = new IntersectionObserver((records) => {
    if (!records.some((record) => record.isIntersecting)) return;
    if (libraryQuery.hasNextPage.value && !libraryQuery.isFetchingNextPage.value) {
      void libraryQuery.fetchNextPage();
    }
  });
  observer.observe(element);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});

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
        <p v-if="libraryQuery.isPending.value" class="state-note">
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
            :status="sessionStatuses.statusFor(entry.sessionId)"
            @open="openEntry(entry)"
            @open-segment="(segment) => openSegment(entry, segment)"
          />
          <!-- Crossing into view asks for the next page. -->
          <div v-if="libraryQuery.hasNextPage.value" ref="sentinel" class="sentinel">
            <span v-if="libraryQuery.isFetchingNextPage.value">Loading more…</span>
          </div>
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

.sentinel {
  display: flex;
  justify-content: center;
  padding: 10px 0 16px;
  color: var(--ink-3);
  font: 400 11px var(--font-ui);
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
