<script setup lang="ts">
import { computed, h } from "vue";
import type { Component } from "vue";
import {
  PhCaretDown as ChevronDown,
  PhCircleNotch as CircleNotch,
  PhCube as Cube,
  PhHouse as House,
  PhMoon as Moon,
  PhPlus as Plus,
  PhX as X,
} from "@phosphor-icons/vue";
import {
  DropdownMenu,
  WorkspaceColorSwatches,
  workspaceAccentVar,
} from "@vynel/ui";
import type { MenuItemModel } from "@vynel/ui";
import type { WorkspaceEffectiveStatus } from "@vynel/contracts/workspaces/workspace-status";
import type { WorkspaceStatusView } from "../../composables/workspaces/use-workspace-status.js";

// The scope tab strip — tabs mode's workspace navigation, in the canvas's
// browser-tab chrome (menu mode collapses it for the sidebar workspace
// tree). Tab one is the pinned Global tab; every other tab is a workspace
// room. Each tab wears the canvas's 16px STATE chip (spinner = running,
// cube = a state is set, moon = parked) and the pulsing status dot (one
// status one colour); parked tabs dim. The active tab sits on the canvas
// ground with its accent bottom edge. Switch/close controls reveal on hover
// so resting tabs stay clean; `+` opens a new room tab. Data-blind like the
// title bar: tabs + workspaces + status views in, events out.
export interface ShellTabItem {
  id: string;
  workspaceId: string | null;
  colorSlot: number | null;
}

const props = defineProps<{
  tabs: ShellTabItem[];
  activeTabId: string;
  workspaces: { id: string; name: string }[];
  // A workspace's customized accent slot (Customize section) — the default a
  // tab starts from; a per-tab pick still overrides it. Colors only the
  // active tab's bottom edge (state owns the chip).
  workspaceColorSlots?: Record<string, number | null>;
  statusByWorkspaceId?: Record<string, WorkspaceStatusView>;
  globalStatus?: WorkspaceEffectiveStatus;
}>();

const emit = defineEmits<{
  "select-tab": [tabId: string];
  "close-tab": [tabId: string];
  "retarget-tab": [tabId: string, workspaceId: string];
  "color-tab": [tabId: string, colorSlot: number | null];
  "add-tab": [workspaceId: string];
  "create-workspace": [];
}>();

function workspaceName(workspaceId: string | null): string {
  if (workspaceId === null) return "Global";
  return (
    props.workspaces.find((workspace) => workspace.id === workspaceId)?.name ??
    "Workspace"
  );
}

function tabStatus(tab: ShellTabItem): WorkspaceEffectiveStatus {
  if (tab.workspaceId === null) return props.globalStatus ?? "not_running";
  return props.statusByWorkspaceId?.[tab.workspaceId]?.status ?? "not_running";
}

const MARK_LABELS = {
  needs_input: "is waiting on you",
  problem: "hit a problem",
  completed: "is completed",
} as const;

function tabMark(tab: ShellTabItem): keyof typeof MARK_LABELS | null {
  const status = tabStatus(tab);
  return status === "needs_input" || status === "problem" || status === "completed"
    ? status
    : null;
}

/** The active tab's bottom edge: the user's per-tab pick wins, then the
 *  workspace's customized color, else the system accent (the canvas's
 *  default — identity hues stay opt-in). */
function tabEdge(tab: ShellTabItem): string {
  if (tab.colorSlot !== null) return `var(--ws-${tab.colorSlot})`;
  if (tab.workspaceId !== null) {
    const customSlot = props.workspaceColorSlots?.[tab.workspaceId];
    if (customSlot !== undefined && customSlot !== null)
      return `var(--ws-${customSlot})`;
  }
  return "var(--gold)";
}

// Each room row in a pick menu wears its own accent dot, so the list reads
// like the strip does.
function workspaceDot(name: string): Component {
  return () =>
    h(
      "span",
      { class: "grid size-4 place-items-center" },
      h("span", {
        class: "size-2.5 rounded-full",
        style: { background: workspaceAccentVar(name) },
      }),
    );
}

// The pick list every dropdown shares — rooms first, then the create action.
// Computed so the dot components stay identity-stable across re-renders
// (fresh functional components each render would remount every dot).
const workspacePickMenu = computed<MenuItemModel[]>(() => [
  ...props.workspaces.map((workspace) => ({
    id: `ws:${workspace.id}`,
    label: workspace.name,
    icon: workspaceDot(workspace.name),
  })),
  ...(props.workspaces.length > 0
    ? [{ id: "sep", kind: "separator" as const }]
    : []),
  { id: "new-workspace", label: "New workspace" },
]);

const tabMenu = computed<MenuItemModel[]>(() => [
  { id: "switch-label", kind: "label", label: "Switch workspace" },
  ...workspacePickMenu.value,
]);

function onTabMenuSelect(tabId: string, itemId: string) {
  if (itemId === "new-workspace") emit("create-workspace");
  else if (itemId.startsWith("ws:")) emit("retarget-tab", tabId, itemId.slice(3));
}

function onAddMenuSelect(itemId: string) {
  if (itemId === "new-workspace") emit("create-workspace");
  else if (itemId.startsWith("ws:")) emit("add-tab", itemId.slice(3));
}
</script>

<template>
  <div
    role="tablist"
    aria-label="Open scopes"
    class="app-tab-strip select-none"
  >
    <div
      v-for="tab in props.tabs"
      :key="tab.id"
      class="app-tab group"
      :class="{
        'is-active': tab.id === props.activeTabId,
        'is-parked':
          tabStatus(tab) === 'not_running' && tab.id !== props.activeTabId,
      }"
      :style="
        tab.id === props.activeTabId
          ? { borderBottomColor: tabEdge(tab) }
          : undefined
      "
    >
      <button
        type="button"
        role="tab"
        :aria-selected="tab.id === props.activeTabId"
        class="flex h-full min-w-0 flex-1 items-center gap-2 pl-1 pr-0.5"
        @click="emit('select-tab', tab.id)"
      >
        <!-- The state chip — same vocabulary as the tree rows. -->
        <span
          class="grid size-4 shrink-0 place-items-center rounded-[4px]"
          :class="
            tabStatus(tab) === 'not_running'
              ? 'bg-[var(--color-neutral-900)] text-[var(--color-neutral-600)]'
              : 'bg-[var(--color-accent-900)] text-[var(--color-accent-200)]'
          "
        >
          <CircleNotch
            v-if="tabStatus(tab) === 'running'"
            :size="10"
            class="animate-spin"
          />
          <House v-else-if="tab.workspaceId === null" :size="10" />
          <Moon v-else-if="tabStatus(tab) === 'not_running'" :size="10" />
          <Cube v-else :size="10" class="text-[var(--color-neutral-500)]" />
        </span>
        <span class="truncate text-[12.5px]">{{ workspaceName(tab.workspaceId) }}</span>
        <span
          v-if="tabMark(tab)"
          :aria-label="`${workspaceName(tab.workspaceId)} ${MARK_LABELS[tabMark(tab)!]}`"
          class="tab-mark size-2 shrink-0 rounded-full"
          :data-status="tabMark(tab)"
        />
      </button>

      <template v-if="tab.workspaceId !== null">
        <DropdownMenu
          :items="tabMenu"
          align="start"
          @select="(itemId) => onTabMenuSelect(tab.id, itemId)"
        >
          <template #trigger>
            <button
              type="button"
              :aria-label="`Switch workspace for ${workspaceName(tab.workspaceId)}`"
              class="grid size-6 shrink-0 place-items-center rounded-sm text-ink-3 opacity-0 transition hover:bg-row-hover hover:text-ink-1 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:bg-row-hover data-[state=open]:text-ink-1 data-[state=open]:opacity-100"
            >
              <ChevronDown :size="12" />
            </button>
          </template>
          <template #footer>
            <WorkspaceColorSwatches
              :selected-slot="tab.colorSlot"
              label="Tab color"
              @pick="(slot) => emit('color-tab', tab.id, slot)"
            />
          </template>
        </DropdownMenu>
        <button
          type="button"
          :aria-label="`Close ${workspaceName(tab.workspaceId)}`"
          class="mr-0.5 grid size-6 shrink-0 place-items-center rounded-sm text-ink-3 opacity-0 transition hover:bg-row-hover hover:text-ink-1 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
          @click.stop="emit('close-tab', tab.id)"
        >
          <X :size="12" />
        </button>
      </template>
    </div>

    <DropdownMenu :items="workspacePickMenu" align="start" @select="onAddMenuSelect">
      <template #trigger>
        <button
          type="button"
          aria-label="New tab"
          title="New tab"
          class="mb-1 grid size-8 shrink-0 place-items-center self-center rounded-sm text-ink-3 transition hover:bg-row-hover hover:text-ink-1 data-[state=open]:bg-row-active data-[state=open]:text-ink-1"
        >
          <Plus :size="15" />
        </button>
      </template>
    </DropdownMenu>
  </div>
</template>

<style scoped>
/* The canvas's strip: chrome ground, hairline base, tabs rising from it. */
.app-tab-strip {
  display: flex;
  align-items: stretch;
  height: 40px;
  flex-shrink: 0;
  padding: 6px 8px 0;
  background: var(--bg-chrome);
  border-bottom: 1px solid var(--hair);
  overflow-x: auto;
  overflow-y: hidden;
}

/* A browser tab: top radius, transparent at rest, the canvas ground +
   accent bottom edge when active. */
.app-tab {
  position: relative;
  display: flex;
  align-items: center;
  max-width: 190px;
  min-width: 0;
  flex: 0 1 auto;
  margin-right: 5px;
  padding: 0 4px 0 8px;
  border-radius: var(--radius-m) var(--radius-m) 0 0;
  border-bottom: 2px solid transparent;
  color: var(--ink-2);
  white-space: nowrap;
  transition:
    background var(--t-fast) var(--ease-out),
    color var(--t-fast) var(--ease-out),
    opacity var(--t-fast) var(--ease-out);
}

.app-tab:hover {
  color: var(--ink-1);
  background: var(--row-hover);
}

.app-tab.is-active {
  background: var(--bg-shell);
  color: var(--ink-1);
}

/* Parked rooms dim — the canvas's 0.55. */
.app-tab.is-parked {
  opacity: 0.55;
}

.app-tab.is-parked:hover {
  opacity: 1;
}

/* One status, one colour — the pulsing mark dot. */
.tab-mark {
  animation: tab-mark-pulse 1.4s ease-in-out infinite;
}

.tab-mark[data-status="needs_input"] {
  background: var(--needs-input);
}

.tab-mark[data-status="problem"] {
  background: var(--danger);
}

.tab-mark[data-status="completed"] {
  background: var(--ok);
}

@keyframes tab-mark-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.35;
    transform: scale(0.72);
  }
}

@media (prefers-reduced-motion: reduce) {
  .tab-mark {
    animation: none;
  }
}
</style>
