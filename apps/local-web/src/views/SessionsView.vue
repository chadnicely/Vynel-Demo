<script setup lang="ts">
import { computed } from "vue";
import { PhClockCounterClockwise as History } from "@phosphor-icons/vue";
import { EmptyState } from "@vynel/ui";
import { useSessionsLibrary } from "../composables/sessions/use-sessions-library.js";
import { useSessionsNavigation } from "../composables/sessions/use-sessions-navigation.js";
import { sessionOpenAffordance } from "../composables/sessions/session-open-affordance.js";
import SessionThreadView from "../components/sessions/SessionThreadView.vue";

// The Sessions view — the PANE alone (Kafi, 2026-08-24): the library lives in
// the sidebar now (SessionsSidebar), the way a room's menus do, so the middle
// list column is gone. Which conversation is open rides the route
// (use-sessions-navigation); this view resolves it against the same library
// pages the sidebar reads (one vue-query key, one fetch) and renders it as a
// normal chat. Opening: a spawned session chats directly at its head; a
// superseded chain part is view-only (locked decision 2); a primary never
// arrives here — its row routes to its Chat.
const navigation = useSessionsNavigation();
const { entries } = useSessionsLibrary(navigation.workspaceScopeId);

interface OpenThread {
  sessionId: string;
  title: string;
  chattable: boolean;
  viewOnlyNote: string | null;
  /** Head opens follow the chain onto a fresh segment live (B6); a
   *  deliberately-opened earlier part stays put. */
  followChain: boolean;
}

const openThread = computed<OpenThread | null>(() => {
  const sessionId = navigation.openSessionId.value;
  if (sessionId === null) return null;
  const entry =
    entries.value.find(
      (row) =>
        row.sessionId === sessionId ||
        row.segments.some((segment) => segment.sessionId === sessionId),
    ) ?? null;

  const partId = navigation.openPartId.value;
  if (partId !== null && partId !== (entry?.sessionId ?? sessionId)) {
    return {
      sessionId: partId,
      title: `${entry?.title ?? "Session"} · earlier part`,
      chattable: false,
      viewOnlyNote:
        entry?.scope === "workspace"
          ? "This part of the conversation was continued — chat carries on in this workspace's Chat."
          : "This part of the conversation was continued — chat carries on at the newest part.",
      followChain: false,
    };
  }

  // The route names the segment that was CLICKED, not the chain's current
  // head: SessionThreadView follows the chain from there (B6), so a swap
  // mid-view re-points quietly instead of remounting on the new head. The
  // direct-send rule + view-only wording live in ONE home shared with the
  // monitor's live pane (session-open-affordance.ts).
  return {
    sessionId,
    title: entry?.title ?? "Session",
    ...sessionOpenAffordance(entry?.scope ?? "spawned"),
    followChain: true,
  };
});
</script>

<template>
  <div class="sessions-view">
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
