<script setup lang="ts">
import { computed } from "vue";
import { History } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import type { SessionsOverviewEntry } from "@vynel/contracts/chat/sessions-overview";
import { useSessionsOverview } from "../../composables/sessions/use-sessions-overview.js";
import { useActivityStore } from "../../stores/activity-store.js";
import { useActivityMonitorStore } from "../../stores/activity-monitor-store.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import SectionHeader from "../sections/SectionHeader.vue";
import SessionRow from "./SessionRow.vue";
import { sessionScopeLabel } from "./session-scope-label.js";

// The Sessions view — every conversation across scopes on one list, newest
// first (the server's order): the global brain as "Assistant", each workspace
// room, and (Slice ④) spawned agents. Live "working" status marries the
// activity feed the app already subscribes to; while anything runs the list
// polls so meters and order stay fresh.
const activity = useActivityStore();
const activityMonitor = useActivityMonitorStore();

const overviewQuery = useSessionsOverview(true, () =>
  activity.isTurnRunning ? 5000 : false,
);

const entries = computed<SessionsOverviewEntry[]>(
  () => overviewQuery.data.value ?? [],
);
const errorText = computed(() =>
  overviewQuery.isError.value
    ? formatSdkError(overviewQuery.error.value)
    : null,
);

function isWorking(entry: SessionsOverviewEntry): boolean {
  if (entry.scope === "global") return activity.hasGlobalServerTurn;
  if (entry.scope === "workspace" && entry.workspaceId !== null)
    return activity.hasServerTurnInWorkspace(entry.workspaceId);
  return false;
}

function openWatch(entry: SessionsOverviewEntry) {
  activityMonitor.openSession(
    entry.sessionId,
    `${sessionScopeLabel(entry)} · ${entry.title}`,
  );
}
</script>

<template>
  <div class="sessions-section flex flex-col gap-2.5">
    <SectionHeader
      :icon="History"
      title="Sessions"
      subtitle="Every conversation, how much room it has left, and what's running now"
    />

    <p v-if="overviewQuery.isPending.value" class="state-note m-0 text-center text-xs text-ink-3">
      Loading conversations…
    </p>

    <p v-else-if="errorText" class="error-note m-0 text-center text-xs text-danger">
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
        @watch="openWatch(entry)"
      />
    </div>
  </div>
</template>
