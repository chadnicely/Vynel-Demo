<script setup lang="ts">
import { computed } from "vue";
import { ArrowLeft, X } from "lucide-vue-next";
import { IconButton, PresenceDot } from "@vynel/ui";
import ThreadStream from "../chat/ThreadStream.vue";
import { useSessionDetail } from "../../composables/chat/use-session-detail.js";
import { useWorkspaceList } from "../../composables/workspaces/use-workspace-list.js";
import { useSessionViewerStore } from "../../stores/session-viewer-store.js";
import { useLiveSessionsStore } from "../../stores/live-sessions-store.js";

// The right-side session viewer: follow ANY session's realtime activity —
// a workspace run the global brain delegated, an agent run the workspace
// delegated — and drill deeper through each "watch live" link (Back returns).
const viewer = useSessionViewerStore();
const liveSessions = useLiveSessionsStore();
const workspacesQuery = useWorkspaceList();

const detailQuery = useSessionDetail(() => viewer.currentSessionId);
const messages = computed(() => detailQuery.data.value?.messages ?? []);
const toolCallsByMessageId = computed(
  () => detailQuery.data.value?.toolCallsByMessageId ?? {},
);

const liveTurn = computed(() =>
  viewer.currentSessionId
    ? liveSessions.liveFor(viewer.currentSessionId)
    : null,
);

const session = computed(() => detailQuery.data.value?.session ?? null);

const contextLabel = computed(() => {
  const workspaceId = session.value?.workspaceId;
  if (!workspaceId) return "";
  return (
    workspacesQuery.data.value?.find((row) => row.id === workspaceId)?.name ??
    "Global"
  );
});
</script>

<template>
  <Transition name="viewer">
    <aside
      v-if="viewer.isOpen"
      class="session-viewer"
      aria-label="Session activity"
    >
      <header class="viewer-header">
        <IconButton v-if="viewer.canGoBack" label="Back" @click="viewer.back()">
          <ArrowLeft :size="15" />
        </IconButton>
        <div class="titles">
          <p class="viewer-title">
            <PresenceDot
              :state="
                liveTurn && liveTurn.status === 'streaming' ? 'live' : 'idle'
              "
            />
            {{ session?.title ?? "Session" }}
          </p>
          <p v-if="contextLabel" class="viewer-context">{{ contextLabel }}</p>
        </div>
        <IconButton label="Close session view" @click="viewer.close()">
          <X :size="15" />
        </IconButton>
      </header>

      <ThreadStream
        class="viewer-thread"
        :messages="messages"
        :tool-calls-by-message-id="toolCallsByMessageId"
        :active-turn="liveTurn"
        @open-session="viewer.drillDown"
        @decide-approval="() => {}"
      />
    </aside>
  </Transition>
</template>

<style scoped>
.session-viewer {
  position: fixed;
  top: 40px;
  right: 0;
  bottom: 0;
  z-index: 45;
  width: min(460px, 92vw);
  display: grid;
  grid-template-rows: auto 1fr;
  background: var(--bg-panel);
  border-left: 1px solid var(--hair-strong);
  box-shadow: var(--shadow-overlay);
}

.viewer-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--hair);
}

.titles {
  flex: 1;
  min-width: 0;
}

.viewer-title {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ink-1);
  font: 600 12.5px/1.5 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.viewer-context {
  margin: 0;
  color: var(--ink-3);
  font: 400 10.5px/1.5 var(--font-ui);
}

.viewer-thread {
  min-height: 0;
  background: var(--bg-shell);
}

.viewer-enter-active,
.viewer-leave-active {
  transition:
    transform var(--t-slow) var(--ease-out),
    opacity var(--t-slow) var(--ease-out);
}

.viewer-enter-from,
.viewer-leave-to {
  transform: translateX(24px);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .viewer-enter-active,
  .viewer-leave-active {
    transition: none;
  }
}
</style>
