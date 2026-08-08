<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { storeToRefs } from "pinia";
import { useConversationSidebarStore } from "../../stores/conversation-sidebar-store.js";
import { useWorkspaceList } from "../../composables/workspaces/use-workspace-list.js";
import LiveSessionPane from "../activity/LiveSessionPane.vue";
import WorkspaceSidebarThread from "./WorkspaceSidebarThread.vue";

// The pointer's landing (live-tracking redesign, Case 1): a docked right panel
// with the REAL conversation — one unified flow, no Activity/Chat tabs, no
// derived views. Session nodes host the same pane the monitor used
// (overview-resolved affordance + chain follow — spawned AND colleagues chat
// directly since G5); workspace nodes resolve the workspace's primary chain
// from the overview and host it the same way (the workspace's own tab stays
// the composer surface until the sidebar's continue-mode send lands — 2c-2).
const sidebar = useConversationSidebarStore();
const { activeNode, stack } = storeToRefs(sidebar);

// Resizable width (Chad, 2026-08-09): drag the left edge; the chosen width
// persists across reloads. The CSS min/max clamp keeps any stored or dragged
// value inside the window, and the thread reflows to fit (no side-scroll).
const WIDTH_STORAGE_KEY = "vynel.sidebar-width";
const DEFAULT_WIDTH = 440;
const MIN_WIDTH = 320;
const MAX_WIDTH = 920;

function readStoredWidth(): number {
  const stored = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
  return Number.isFinite(stored) && stored >= MIN_WIDTH && stored <= MAX_WIDTH
    ? stored
    : DEFAULT_WIDTH;
}
const panelWidth = ref(readStoredWidth());

// Pointer capture keeps the drag on the handle even when the cursor leaves
// it — no document-level listeners to leak. Text selection is suspended for
// the drag: the browser otherwise starts selecting across the page under
// the moving cursor.
let settleActiveDrag: (() => void) | null = null;

function startResize(event: PointerEvent) {
  // One gesture at a time — a second pointer (touch during a mouse drag)
  // would nest userSelect snapshots and could restore to "none".
  if (settleActiveDrag !== null) return;
  event.preventDefault();
  const handle = event.currentTarget as HTMLElement;
  // Optional-chained: happy-dom's elements don't implement pointer capture.
  handle.setPointerCapture?.(event.pointerId);
  const restoreUserSelect = document.body.style.userSelect;
  document.body.style.userSelect = "none";
  const onMove = (move: PointerEvent) => {
    panelWidth.value = Math.min(
      MAX_WIDTH,
      Math.max(MIN_WIDTH, Math.round(window.innerWidth - move.clientX)),
    );
  };
  const settle = () => {
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", settle);
    handle.removeEventListener("pointercancel", settle);
    document.body.style.userSelect = restoreUserSelect;
    localStorage.setItem(WIDTH_STORAGE_KEY, String(panelWidth.value));
    settleActiveDrag = null;
  };
  settleActiveDrag = settle;
  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", settle);
  handle.addEventListener("pointercancel", settle);
}

// Closing the panel mid-drag (✕, Esc, a programmatic close) unmounts the
// handle with its listeners — the body's userSelect must not stay "none".
onBeforeUnmount(() => settleActiveDrag?.());

const workspacesQuery = useWorkspaceList();
const headerTitle = computed(() => {
  const node = activeNode.value;
  if (node === null) return "";
  if (node.kind === "session") return node.title;
  const workspace = (workspacesQuery.data.value ?? []).find(
    (row) => row.id === node.workspaceId,
  );
  return workspace === undefined
    ? "Workspace"
    : `${workspace.managerName ?? "Assistant"} · ${workspace.name}`;
});
</script>

<template>
  <Transition name="sidebar-slide">
    <aside
      v-if="activeNode"
      class="conversation-sidebar"
      data-testid="conversation-sidebar"
      :style="{ width: `${panelWidth}px` }"
    >
      <div
        class="resize-handle"
        aria-hidden="true"
        @pointerdown="startResize"
      />
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
        <WorkspaceSidebarThread
          v-else
          :key="activeNode.workspaceId"
          :workspace-id="activeNode.workspaceId"
          :anchor-trace-id="activeNode.anchorTraceId ?? undefined"
        />
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
  /* Width comes from the resize drag (inline style); these clamp any stored
     value into the window so a small screen never traps the panel. */
  min-width: 320px;
  max-width: 92vw;
  border-left: 1px solid var(--hair);
  background: var(--bg-panel);
  box-shadow: -18px 0 40px rgb(0 0 0 / 0.25);
}
.resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -3px;
  width: 7px;
  cursor: col-resize;
  touch-action: none;
  /* Above the panel's content — the thread pane is position:relative (its
     jump pill) and would otherwise paint over the handle's inner pixels,
     leaving only a ~3px grab strip outside the border. */
  z-index: 1;
}
.resize-handle:hover,
.resize-handle:active {
  background: var(--row-hover);
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
