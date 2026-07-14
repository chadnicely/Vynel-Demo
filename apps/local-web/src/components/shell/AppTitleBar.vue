<script setup lang="ts">
import { computed } from "vue";
import { ChevronsUpDown } from "lucide-vue-next";
import {
  DropdownMenu,
  PresenceDot,
  workspaceAccentVar,
  workspaceMonogram,
} from "@vynel/ui";
import type { MenuItemModel } from "@vynel/ui";
import { useWindowControls } from "../../composables/shell/use-window-controls.js";

// The desktop title bar with an integrated menu (the Windows 11 / VS Code
// pattern — one bar carries identity, menus, the workspace switcher, window
// title, presence, and the window controls). Data-blind: it renders menus +
// emits `command`; the shell decides what each id does. Window controls drive
// the frameless Tauri window (no-op in the browser).
const props = defineProps<{
  title: string;
  presenceState: "idle" | "live" | "attention";
  presenceLabel: string;
  theme: "dark" | "light";
  sidebarOpen: boolean;
  dockOpen: boolean;
  workspaces: { id: string; name: string }[];
  activeWorkspaceId: string | null;
}>();

const emit = defineEmits<{
  command: [id: string];
  "select-workspace": [id: string];
  "select-global": [];
  "create-workspace": [];
}>();

const controls = useWindowControls();

const inWorkspace = computed(() => props.activeWorkspaceId !== null);
const activeWorkspaceName = computed(
  () =>
    props.workspaces.find((w) => w.id === props.activeWorkspaceId)?.name ?? null,
);

const workspaceMenu = computed<MenuItemModel[]>(() => [
  { id: "global", label: "Global chat" },
  ...(props.workspaces.length > 0
    ? [{ id: "ws-label", kind: "label" as const, label: "Workspaces" }]
    : []),
  ...props.workspaces.map((workspace) => ({
    id: `ws:${workspace.id}`,
    label: workspace.name,
  })),
  { id: "sep", kind: "separator" as const },
  { id: "new-workspace", label: "New workspace" },
]);

function onWorkspaceSelect(id: string) {
  if (id === "new-workspace") emit("create-workspace");
  else if (id === "global") emit("select-global");
  else if (id.startsWith("ws:")) emit("select-workspace", id.slice(3));
}

const menus = computed<{ label: string; items: MenuItemModel[] }[]>(() => [
  {
    label: "Vynel",
    items: [
      { id: "settings", label: "Settings", shortcut: "⌘," },
      { id: "account", label: "Account" },
      { id: "sep-1", kind: "separator" },
      { id: "quit", label: "Quit Vynel", shortcut: "⌘Q", danger: true },
    ],
  },
  {
    label: "Assistant",
    items: [
      { id: "new-chat", label: "New chat", shortcut: "⌘N" },
      { id: "new-workspace", label: "New workspace", shortcut: "⌘⇧N" },
      { id: "sep-3", kind: "separator" },
      { id: "start-voice", label: "Start voice" },
    ],
  },
  {
    label: "View",
    items: [
      { id: "toggle-sidebar", kind: "checkbox", label: "Show navigation", checked: props.sidebarOpen },
      { id: "toggle-dock", kind: "checkbox", label: "Show side panel", checked: props.dockOpen },
      { id: "sep-4", kind: "separator" },
      { id: "toggle-theme", label: props.theme === "dark" ? "Light theme" : "Dark theme" },
      { id: "sep-5", kind: "separator" },
      { id: "command-palette", label: "Command palette", shortcut: "⌘K" },
    ],
  },
  {
    label: "Go",
    items: [
      { id: "go-home", label: "Home" },
      { id: "go-chat", label: "Chat" },
      { id: "go-workspace", label: "Workspace" },
    ],
  },
]);

// "Quit" drives the window directly (the window controls live here); everything
// else is a command for the shell to route.
function onMenuCommand(id: string) {
  if (id === "quit") controls.close();
  else emit("command", id);
}
</script>

<template>
  <header
    class="flex h-10 shrink-0 items-center gap-0.5 border-b border-hair bg-shell pl-2 pr-0 select-none"
    data-tauri-drag-region
  >
    <!-- Identity mark (neutral — gold stays reserved for presence) -->
    <span class="mr-1 grid size-6 shrink-0 place-items-center rounded-sm text-ink-2">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 2 22 12 12 22 2 12Z"
          stroke="currentColor"
          stroke-width="2"
          stroke-linejoin="round"
        />
      </svg>
    </span>

    <!-- Menu bar -->
    <nav class="flex items-center gap-0.5">
      <DropdownMenu
        v-for="menu in menus"
        :key="menu.label"
        :items="menu.items"
        align="start"
        @select="onMenuCommand"
        @toggle="(id) => emit('command', id)"
      >
        <template #trigger>
          <button
            type="button"
            class="rounded-sm px-2 py-1 text-sm text-ink-2 transition hover:bg-row-hover hover:text-ink-1 data-[state=open]:bg-row-active data-[state=open]:text-ink-1"
          >
            {{ menu.label }}
          </button>
        </template>
      </DropdownMenu>
    </nav>

    <!-- Workspace switcher (sits after the menu bar) -->
    <span class="mx-1.5 h-4 w-px bg-hair" aria-hidden="true" />
    <DropdownMenu
      :items="workspaceMenu"
      align="start"
      @select="onWorkspaceSelect"
    >
      <template #trigger>
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-sm py-1 pl-1 pr-1.5 text-sm transition hover:bg-row-hover data-[state=open]:bg-row-active"
        >
          <span
            class="grid size-4 shrink-0 place-items-center rounded-[3px] text-[9px] font-semibold text-white"
            :style="{
              background: inWorkspace
                ? workspaceAccentVar(activeWorkspaceName ?? '')
                : 'var(--ink-3)',
            }"
          >
            {{ inWorkspace ? workspaceMonogram(activeWorkspaceName ?? "") : "⌂" }}
          </span>
          <span :class="inWorkspace ? 'text-ink-1' : 'text-ink-2'">
            {{ inWorkspace ? activeWorkspaceName : "Global chat" }}
          </span>
          <ChevronsUpDown :size="12" class="text-ink-3" />
        </button>
      </template>
    </DropdownMenu>

    <!-- Center: window title + presence (the drag region) -->
    <div
      class="flex flex-1 items-center justify-center gap-2 px-4"
      data-tauri-drag-region
    >
      <PresenceDot :state="props.presenceState" :label="props.presenceLabel" />
      <span class="truncate text-xs text-ink-2">{{ props.title }}</span>
    </div>

    <!-- Window controls (frameless Tauri; simulated in the browser) -->
    <div class="flex h-full items-stretch">
      <button
        type="button"
        aria-label="Minimize"
        class="grid h-full w-11 place-items-center text-ink-3 transition hover:bg-row-hover hover:text-ink-1"
        @click="controls.minimize()"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5h10" stroke="currentColor" stroke-width="1.2" /></svg>
      </button>
      <button
        type="button"
        :aria-label="controls.isMaximized.value ? 'Restore' : 'Maximize'"
        class="grid h-full w-11 place-items-center text-ink-3 transition hover:bg-row-hover hover:text-ink-1"
        @click="controls.toggleMaximize()"
      >
        <svg v-if="controls.isMaximized.value" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <rect x="0.5" y="2.5" width="6" height="6" stroke="currentColor" stroke-width="1.1" />
          <path d="M3 2.5V0.5h6v6H7" stroke="currentColor" stroke-width="1.1" />
        </svg>
        <svg v-else width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" stroke-width="1.1" /></svg>
      </button>
      <button
        type="button"
        aria-label="Close"
        class="grid h-full w-11 place-items-center text-ink-3 transition hover:bg-danger hover:text-white"
        @click="controls.close()"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1.2" /></svg>
      </button>
    </div>
  </header>
</template>
