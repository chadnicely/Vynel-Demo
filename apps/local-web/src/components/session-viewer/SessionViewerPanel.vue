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

// Any session opened here is read by id through the root ("view X"). Live
// drill-down waits on a per-session subscribe endpoint (deferred) — on real
// data no delegation links surface yet, so this stays dormant until then.
const VIEWER_SCOPE = { kind: "global" } as const;
const detailQuery = useSessionDetail(
  () => VIEWER_SCOPE,
  () => viewer.currentSessionId,
);
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
  <Teleport to="body">
    <Transition name="viewer">
      <div v-if="viewer.isOpen" class="viewer-layer">
        <div class="scrim" @click="viewer.close()" />
        <aside class="session-viewer" aria-label="Session activity">
          <header class="viewer-header">
            <IconButton
              v-if="viewer.canGoBack"
              label="Back"
              @click="viewer.back()"
            >
              <ArrowLeft :size="15" />
            </IconButton>
            <div class="titles">
              <p class="viewer-title">
                <PresenceDot
                  :state="
                    liveTurn && liveTurn.status === 'streaming'
                      ? 'live'
                      : 'idle'
                  "
                />
                {{ session?.title ?? "Session" }}
              </p>
              <p v-if="contextLabel" class="viewer-context">
                {{ contextLabel }}
              </p>
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
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* A floating overlay window (Chad's call), not a docked rail: detached from
   the edges, rounded, heavy shadow; the light scrim closes on click. */
.viewer-layer {
  position: fixed;
  inset: 40px 0 0 0;
  z-index: 45;
}

.scrim {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--bg-shell) 45%, transparent);
}

.session-viewer {
  position: absolute;
  top: 12px;
  right: 14px;
  bottom: 14px;
  /* Just under half the window, with sane floors/ceilings. */
  width: clamp(460px, 48vw, 92vw);
  display: grid;
  grid-template-rows: auto 1fr;
  background: var(--bg-panel);
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-l);
  overflow: hidden;
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
  transition: opacity var(--t-slow) var(--ease-out);
}

.viewer-enter-active .session-viewer,
.viewer-leave-active .session-viewer {
  transition: transform var(--t-slow) var(--ease-out);
}

.viewer-enter-from,
.viewer-leave-to {
  opacity: 0;
}

.viewer-enter-from .session-viewer,
.viewer-leave-to .session-viewer {
  transform: translateX(24px);
}

@media (prefers-reduced-motion: reduce) {
  .viewer-enter-active,
  .viewer-leave-active,
  .viewer-enter-active .session-viewer,
  .viewer-leave-active .session-viewer {
    transition: none;
  }
}
</style>
