<script setup lang="ts">
import { ChevronDown, House, Plus, X } from "lucide-vue-next";
import {
  DropdownMenu,
  workspaceAccentVar,
  workspaceMonogram,
} from "@vynel/ui";
import type { MenuItemModel } from "@vynel/ui";

// The scope tab strip (below the title bar) — the ONLY workspace navigation.
// Tab one is the pinned Global tab; every other tab is a workspace room with
// its own dropdown to point it at a different room, and a close button. `+`
// opens a new room tab. Data-blind like the title bar: tabs + workspaces in,
// events out; the shell decides what happens.
export interface ShellTabItem {
  id: string;
  workspaceId: string | null;
}

const props = defineProps<{
  tabs: ShellTabItem[];
  activeTabId: string;
  workspaces: { id: string; name: string }[];
}>();

const emit = defineEmits<{
  "select-tab": [tabId: string];
  "close-tab": [tabId: string];
  "retarget-tab": [tabId: string, workspaceId: string];
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

// The pick list every dropdown shares — rooms first, then the create action.
const workspacePickMenu = (): MenuItemModel[] => [
  ...props.workspaces.map((workspace) => ({
    id: `ws:${workspace.id}`,
    label: workspace.name,
  })),
  ...(props.workspaces.length > 0
    ? [{ id: "sep", kind: "separator" as const }]
    : []),
  { id: "new-workspace", label: "New workspace" },
];

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
    class="flex h-9 shrink-0 items-center gap-1 border-b border-hair bg-shell px-2 select-none"
  >
    <div
      v-for="tab in props.tabs"
      :key="tab.id"
      class="group flex h-7 max-w-56 items-center rounded-sm transition"
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
        class="flex min-w-0 items-center gap-1.5 py-1 pl-1.5 text-sm"
        :class="tab.workspaceId === null ? 'pr-2.5' : 'pr-1'"
        @click="emit('select-tab', tab.id)"
      >
        <span
          v-if="tab.workspaceId === null"
          class="grid size-4 shrink-0 place-items-center rounded-[3px] bg-[var(--ink-3)] text-white"
        >
          <House :size="10" />
        </span>
        <span
          v-else
          class="grid size-4 shrink-0 place-items-center rounded-[3px] text-[9px] font-semibold text-white"
          :style="{ background: workspaceAccentVar(workspaceName(tab.workspaceId)) }"
        >
          {{ workspaceMonogram(workspaceName(tab.workspaceId)) }}
        </span>
        <span class="truncate">{{ workspaceName(tab.workspaceId) }}</span>
      </button>

      <template v-if="tab.workspaceId !== null">
        <DropdownMenu
          :items="workspacePickMenu()"
          align="start"
          @select="(itemId) => onTabMenuSelect(tab.id, itemId)"
        >
          <template #trigger>
            <button
              type="button"
              :aria-label="`Switch workspace for ${workspaceName(tab.workspaceId)}`"
              class="grid size-5 shrink-0 place-items-center rounded-sm text-ink-3 transition hover:bg-row-hover hover:text-ink-1 data-[state=open]:bg-row-hover data-[state=open]:text-ink-1"
            >
              <ChevronDown :size="11" />
            </button>
          </template>
        </DropdownMenu>
        <button
          type="button"
          :aria-label="`Close ${workspaceName(tab.workspaceId)}`"
          class="mr-1 grid size-5 shrink-0 place-items-center rounded-sm text-ink-3 transition hover:bg-row-hover hover:text-ink-1"
          @click.stop="emit('close-tab', tab.id)"
        >
          <X :size="11" />
        </button>
      </template>
    </div>

    <DropdownMenu :items="workspacePickMenu()" align="start" @select="onAddMenuSelect">
      <template #trigger>
        <button
          type="button"
          aria-label="New tab"
          title="New tab"
          class="grid size-7 shrink-0 place-items-center rounded-sm text-ink-3 transition hover:bg-row-hover hover:text-ink-1 data-[state=open]:bg-row-active data-[state=open]:text-ink-1"
        >
          <Plus :size="14" />
        </button>
      </template>
    </DropdownMenu>
  </div>
</template>
