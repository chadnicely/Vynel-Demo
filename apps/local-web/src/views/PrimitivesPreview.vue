<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  PhBell as Bell,
  PhCopy as Copy,
  PhFilePlus as FilePlus,
  PhTreeView as FolderTree,
  PhMoon as Moon,
  PhPencilSimple as Pencil,
  PhMagnifyingGlass as Search,
  PhGearSix as Settings,
  PhSun as Sun,
  PhTrash as Trash2,
} from "@phosphor-icons/vue";
import {
  CommandPalette,
  ConfirmButton,
  ContextMenu,
  DropdownMenu,
  IconButton,
  Modal,
  ResizablePanel,
  Tooltip,
} from "@vynel/ui";
import type { CommandItem, MenuItemModel } from "@vynel/ui";
import { useUiStore } from "../stores/ui-store.js";

// A living gallery for the reinvented desktop primitives (Tailwind + Reka UI).
// Doubles as the visual proof of the token bridge — everything here is styled
// with the new utilities (bg-panel, text-ink-1, border-hair, …).
const ui = useUiStore();

const lastAction = ref("—");
function note(action: string) {
  lastAction.value = action;
}

const fileMenu: MenuItemModel[] = [
  { id: "new-chat", label: "New chat", icon: FilePlus, shortcut: "⌘N" },
  { id: "new-workspace", label: "New workspace", shortcut: "⌘⇧N" },
  { id: "sep-1", kind: "separator" },
  { id: "settings", label: "Settings", icon: Settings, shortcut: "⌘," },
];

const viewMenu: MenuItemModel[] = [
  { id: "left", kind: "checkbox", label: "Show navigation", checked: true },
  { id: "right", kind: "checkbox", label: "Show side panel", checked: false },
  { id: "sep", kind: "separator" },
  { id: "palette", label: "Command palette", shortcut: "⌘K" },
];
const viewChecks = ref<Record<string, boolean>>({ left: true, right: false });
const viewMenuItems = computed<MenuItemModel[]>(() =>
  viewMenu.map((item) =>
    item.kind === "checkbox"
      ? { ...item, checked: viewChecks.value[item.id] ?? false }
      : item,
  ),
);

const contextItems: MenuItemModel[] = [
  { id: "copy", label: "Copy", icon: Copy, shortcut: "⌘C" },
  { id: "rename", label: "Rename", icon: Pencil },
  { id: "sep", kind: "separator" },
  { id: "delete", label: "Delete", icon: Trash2, danger: true },
];

const commands: CommandItem[] = [
  { id: "new-chat", label: "New chat", group: "Assistant", shortcut: "⌘N" },
  { id: "new-workspace", label: "New workspace", group: "Assistant" },
  { id: "start-voice", label: "Start voice", group: "Assistant" },
  { id: "toggle-theme", label: "Toggle theme", group: "View", keywords: "dark light appearance" },
  { id: "toggle-nav", label: "Toggle navigation", group: "View" },
  { id: "go-home", label: "Go to Home", group: "Go" },
  { id: "go-chat", label: "Go to Chat", group: "Go" },
  { id: "go-workspace", label: "Go to Workspace", group: "Go" },
];

const isModalOpen = ref(false);
const isPaletteOpen = ref(false);
const isRightPanelOpen = ref(true);

const swatches = [
  { name: "shell", cls: "bg-shell" },
  { name: "panel", cls: "bg-panel" },
  { name: "raised", cls: "bg-raised" },
  { name: "gold", cls: "bg-gold" },
  { name: "claude", cls: "bg-claude" },
  { name: "ok", cls: "bg-ok" },
  { name: "danger", cls: "bg-danger" },
  { name: "info", cls: "bg-info" },
];

function onKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    isPaletteOpen.value = true;
  }
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div class="flex h-screen flex-col bg-shell text-ink-1">
    <!-- Title + menu bar (a taste of the reinvented shell chrome) -->
    <header
      class="flex h-10 items-center gap-1 border-b border-hair px-2.5 select-none"
    >
      <span class="mr-2 grid size-5 place-items-center rounded-sm bg-gold-soft text-gold">◈</span>
      <DropdownMenu :items="fileMenu" @select="note(`menu: ${$event}`)">
        <template #trigger>
          <button type="button" class="rounded-sm px-2 py-1 text-sm text-ink-2 transition hover:bg-row-hover hover:text-ink-1 data-[state=open]:bg-row-active data-[state=open]:text-ink-1">
            Vynel
          </button>
        </template>
      </DropdownMenu>
      <DropdownMenu
        :items="viewMenuItems"
        @select="(id) => (id === 'palette' ? (isPaletteOpen = true) : note(`view: ${id}`))"
        @toggle="(id, checked) => (viewChecks[id] = checked)"
      >
        <template #trigger>
          <button type="button" class="rounded-sm px-2 py-1 text-sm text-ink-2 transition hover:bg-row-hover hover:text-ink-1 data-[state=open]:bg-row-active data-[state=open]:text-ink-1">
            View
          </button>
        </template>
      </DropdownMenu>

      <div class="ml-auto flex items-center gap-1.5">
        <Tooltip label="Search commands (⌘K)">
          <IconButton label="Command palette" @click="isPaletteOpen = true">
            <Search :size="15" />
          </IconButton>
        </Tooltip>
        <Tooltip label="Notifications">
          <IconButton label="Notifications"><Bell :size="15" /></IconButton>
        </Tooltip>
        <Tooltip :label="ui.theme === 'dark' ? 'Switch to light' : 'Switch to dark'">
          <IconButton label="Toggle theme" @click="ui.toggleTheme()">
            <Sun v-if="ui.theme === 'dark'" :size="15" />
            <Moon v-else :size="15" />
          </IconButton>
        </Tooltip>
      </div>
    </header>

    <!-- Resizable shell body -->
    <div class="flex min-h-0 flex-1">
      <ResizablePanel
        side="left"
        storage-key="preview.nav.width"
        :default-width="220"
      >
        <nav class="h-full bg-panel p-2 text-sm">
          <p class="px-2 pb-1 pt-1 text-2xs font-semibold uppercase tracking-wider text-ink-3">
            Navigation
          </p>
          <button
            v-for="label in ['Home', 'Chat', 'Workspace']"
            :key="label"
            type="button"
            class="flex w-full cursor-default rounded-sm px-2.5 py-1.5 text-left text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
          >
            {{ label }}
          </button>
          <p class="px-2 pb-1 pt-3 text-2xs">Drag the divider →</p>
        </nav>
      </ResizablePanel>

      <main class="min-w-0 flex-1 overflow-y-auto p-8">
        <div class="mx-auto flex max-w-3xl flex-col gap-8">
          <div>
            <h1 class="m-0 font-display text-display font-semibold tracking-tight">
              Desktop primitives
            </h1>
            <p class="mt-1 text-sm text-ink-2">
              Tailwind + Reka UI on the Vynel token bridge. Last action:
              <span class="text-gold">{{ lastAction }}</span>
            </p>
          </div>

          <section class="flex flex-col gap-3">
            <h2 class="m-0 text-2xs font-semibold uppercase tracking-wider text-ink-3">Token bridge</h2>
            <div class="flex flex-wrap gap-3">
              <div v-for="s in swatches" :key="s.name" class="flex flex-col items-center gap-1.5">
                <div :class="['size-14 rounded-md border border-hair', s.cls]" />
                <span class="text-2xs text-ink-3">{{ s.name }}</span>
              </div>
            </div>
          </section>

          <section class="flex flex-col gap-3">
            <h2 class="m-0 text-2xs font-semibold uppercase tracking-wider text-ink-3">Overlays</h2>
            <div class="flex flex-wrap items-center gap-3">
              <button
                type="button"
                class="cursor-default rounded-sm border border-hair bg-raised px-3 py-1.5 text-sm text-ink-1 transition hover:border-hair-strong"
                @click="isModalOpen = true"
              >
                Open modal
              </button>
              <button
                type="button"
                class="cursor-default rounded-sm border border-hair bg-raised px-3 py-1.5 text-sm text-ink-1 transition hover:border-hair-strong"
                @click="isPaletteOpen = true"
              >
                Command palette (⌘K)
              </button>
              <ContextMenu :items="contextItems" @select="note(`context: ${$event}`)">
                <div class="grid h-16 w-56 cursor-default place-items-center rounded-md border border-dashed border-hair-strong text-sm text-ink-3">
                  <span class="flex items-center gap-1.5"><FolderTree :size="14" /> Right-click me</span>
                </div>
              </ContextMenu>
            </div>
          </section>

          <section class="flex flex-col gap-3">
            <h2 class="m-0 text-2xs font-semibold uppercase tracking-wider text-ink-3">Confirm</h2>
            <div class="flex flex-wrap items-center gap-3">
              <ConfirmButton label="Remove device" confirm-label="Sure? Remove" danger @confirm="note('confirmed: remove')">
                <template #icon><Trash2 :size="14" /></template>
              </ConfirmButton>
              <ConfirmButton label="Reset layout" @confirm="note('confirmed: reset')" />
            </div>
          </section>
        </div>
      </main>

      <ResizablePanel
        v-if="isRightPanelOpen"
        side="right"
        storage-key="preview.side.width"
        :default-width="300"
      >
        <aside class="h-full bg-panel p-4 text-sm text-ink-2">
          <p class="m-0 text-2xs font-semibold uppercase tracking-wider text-ink-3">Side panel</p>
          <p class="mt-2">Drag its left edge to resize. The width persists across reloads.</p>
        </aside>
      </ResizablePanel>
    </div>

    <!-- Status bar -->
    <footer class="flex h-[22px] items-center gap-2 border-t border-hair bg-panel px-3 text-2xs text-ink-3 select-none">
      <span class="size-1.5 rounded-full bg-ink-3" />
      <span>idle · preview · {{ ui.theme }} theme</span>
    </footer>

    <Modal v-model:open="isModalOpen" title="Add memory" description="One accessible base for every dialog." size="md">
      <p class="text-sm text-ink-2">
        This modal comes from Reka's Dialog — focus-trapped, Esc-closable,
        scroll-locked. It retires the six hand-rolled dialogs.
      </p>
      <template #footer>
        <button type="button" class="cursor-default rounded-sm px-3 py-1.5 text-sm text-ink-2 transition hover:bg-row-hover hover:text-ink-1" @click="isModalOpen = false">Cancel</button>
        <button type="button" class="cursor-default rounded-sm bg-gold px-3 py-1.5 text-sm font-medium text-shell transition hover:bg-gold-bright" @click="note('modal: saved'); isModalOpen = false">Save</button>
      </template>
    </Modal>

    <CommandPalette v-model:open="isPaletteOpen" :commands="commands" @select="note(`command: ${$event}`)" />
  </div>
</template>
