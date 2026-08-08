<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useConversationSidebarStore } from "../../stores/conversation-sidebar-store.js";
import { useSessionsOverview } from "../../composables/sessions/use-sessions-overview.js";
import LiveSessionPane from "../activity/LiveSessionPane.vue";

// The pointer's landing (live-tracking redesign, Case 1): a docked right panel
// with the REAL conversation — one unified flow, no Activity/Chat tabs, no
// derived views. Session nodes host the same pane the monitor used
// (overview-resolved affordance + chain follow — spawned AND colleagues chat
// directly since G5); workspace nodes resolve the workspace's primary chain
// from the overview and host it the same way (the workspace's own tab stays
// the composer surface until the sidebar's continue-mode send lands — 2c-2).
const sidebar = useConversationSidebarStore();
const { activeNode, stack } = storeToRefs(sidebar);

const overviewQuery = useSessionsOverview(() => activeNode.value?.kind === "workspace");
const workspaceEntry = computed(() => {
  const node = activeNode.value;
  if (node?.kind !== "workspace") return null;
  return (
    (overviewQuery.data.value ?? []).find(
      (entry) => entry.scope === "workspace" && entry.workspaceId === node.workspaceId,
    ) ?? null
  );
});

const headerTitle = computed(() => {
  const node = activeNode.value;
  if (node === null) return "";
  return node.kind === "session" ? node.title : (workspaceEntry.value?.title ?? "Workspace");
});
</script>

<template>
  <Transition name="sidebar-slide">
    <aside v-if="activeNode" class="conversation-sidebar" data-testid="conversation-sidebar">
      <header class="sidebar-header">
        <button
          v-if="stack.length > 1"
          type="button"
          class="sidebar-nav"
          aria-label="Back"
          @click="sidebar.back()"
        >
          ←
        </button>
        <span class="sidebar-title">{{ headerTitle }}</span>
        <button
          type="button"
          class="sidebar-nav"
          aria-label="Close"
          @click="sidebar.close()"
        >
          ✕
        </button>
      </header>
      <div class="sidebar-body">
        <LiveSessionPane
          v-if="activeNode.kind === 'session'"
          :key="activeNode.sessionId"
          :session-id="activeNode.sessionId"
          :title="activeNode.title"
          :anchor-trace-id="activeNode.anchorTraceId ?? undefined"
        />
        <LiveSessionPane
          v-else-if="workspaceEntry"
          :key="workspaceEntry.sessionId"
          :session-id="workspaceEntry.sessionId"
          :title="workspaceEntry.title"
          :anchor-trace-id="activeNode.anchorTraceId ?? undefined"
        />
        <p v-else class="sidebar-empty">Loading the conversation…</p>
      </div>
    </aside>
  </Transition>
</template>

<style scoped>
.conversation-sidebar {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  width: min(440px, 92vw);
  border-left: 1px solid var(--hair);
  background: var(--bg-panel);
  box-shadow: -18px 0 40px rgb(0 0 0 / 0.25);
}
.sidebar-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--hair);
}
.sidebar-title {
  flex: 1;
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-1);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sidebar-nav {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
}
.sidebar-nav:hover {
  background: var(--row-hover);
  color: var(--ink-1);
}
.sidebar-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.sidebar-body > * {
  flex: 1;
  min-height: 0;
}
.sidebar-empty {
  margin: 24px;
  font-size: 12.5px;
  color: var(--ink-3);
}
.sidebar-slide-enter-active,
.sidebar-slide-leave-active {
  transition: transform 180ms ease;
}
.sidebar-slide-enter-from,
.sidebar-slide-leave-to {
  transform: translateX(100%);
}
</style>
