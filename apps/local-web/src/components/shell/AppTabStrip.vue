<script setup lang="ts">
import { computed, h } from "vue";
import type { Component } from "vue";
import {
  PhCaretDown as ChevronDown,
  PhHouse as House,
  PhPlus as Plus,
  PhX as X,
} from "@phosphor-icons/vue";
import {
  DropdownMenu,
  WorkspaceColorSwatches,
  workspaceAccentVar,
  workspaceMonogram,
} from "@vynel/ui";
import type { MenuItemModel } from "@vynel/ui";

// The scope tab strip (below the title bar) — the ONLY workspace navigation.
// Tab one is the pinned Global tab; every other tab is a workspace room.
// Uniform browser-style tabs: same width, the tab's accent underlines the
// active one, and the switch/close controls reveal on hover so resting tabs
// stay clean. Each room tab's dropdown switches its workspace and paints the
// tab; `+` opens a new room tab. Data-blind like the title bar: tabs +
// workspaces in, events out; the shell decides what happens.
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
  // tab starts from; a per-tab pick still overrides it.
  workspaceColorSlots?: Record<string, number | null>;
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

/** The tab's accent: the user's per-tab pick wins, then the workspace's
 *  customized color, else the room's name-derived color; the Global tab
 *  stays neutral (gold is reserved for presence). */
function tabAccent(tab: ShellTabItem): string {
  if (tab.colorSlot !== null) return `var(--ws-${tab.colorSlot})`;
  if (tab.workspaceId === null) return "var(--ink-3)";
  const customSlot = props.workspaceColorSlots?.[tab.workspaceId];
  if (customSlot !== undefined && customSlot !== null)
    return `var(--ws-${customSlot})`;
  return workspaceAccentVar(workspaceName(tab.workspaceId));
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
    class="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-hair bg-shell px-2 select-none"
  >
    <div
      v-for="tab in props.tabs"
      :key="tab.id"
      class="group relative flex h-8 w-44 shrink-0 items-center rounded-sm transition"
      :class="
        tab.id === props.activeTabId
          ? 'bg-row-active text-ink-1'
          : 'text-ink-2 hover:bg-row-hover hover:text-ink-1'
      "
    >
      <button
        type="button"
        role="tab"
        :aria-selected="tab.id === props.activeTabId"
        class="flex h-full min-w-0 flex-1 items-center gap-2 py-1 pl-2 pr-1 text-sm"
        @click="emit('select-tab', tab.id)"
      >
        <span
          v-if="tab.workspaceId === null"
          class="grid size-5 shrink-0 place-items-center rounded-[4px] text-white"
          :style="{ background: tabAccent(tab) }"
        >
          <House :size="12" />
        </span>
        <span
          v-else
          class="grid size-5 shrink-0 place-items-center rounded-[4px] text-[10px] font-semibold text-white"
          :style="{ background: tabAccent(tab) }"
        >
          {{ workspaceMonogram(workspaceName(tab.workspaceId)) }}
        </span>
        <span class="truncate">{{ workspaceName(tab.workspaceId) }}</span>
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
          class="mr-1 grid size-6 shrink-0 place-items-center rounded-sm text-ink-3 opacity-0 transition hover:bg-row-hover hover:text-ink-1 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
          @click.stop="emit('close-tab', tab.id)"
        >
          <X :size="12" />
        </button>
      </template>

      <!-- The tab's accent underline — the colorized identity of the active tab. -->
      <span
        v-if="tab.id === props.activeTabId"
        aria-hidden="true"
        class="absolute inset-x-1.5 bottom-0 h-0.5 rounded-full"
        :style="{ background: tabAccent(tab) }"
      />
    </div>

    <DropdownMenu :items="workspacePickMenu" align="start" @select="onAddMenuSelect">
      <template #trigger>
        <button
          type="button"
          aria-label="New tab"
          title="New tab"
          class="grid size-8 shrink-0 place-items-center rounded-sm text-ink-3 transition hover:bg-row-hover hover:text-ink-1 data-[state=open]:bg-row-active data-[state=open]:text-ink-1"
        >
          <Plus :size="15" />
        </button>
      </template>
    </DropdownMenu>
  </div>
</template>
