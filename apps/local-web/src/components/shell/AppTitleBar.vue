<script setup lang="ts">
import { computed, ref } from "vue";
import {
  PhBrowsers as Browsers,
  PhCommand as Command,
  PhDiamondsFour as DiamondsFour,
  PhFolderPlus as FolderPlus,
  PhList as List,
  PhListChecks as ListChecks,
  PhMinus as Minus,
  PhMoon as Moon,
  PhSidebarSimple as PanelLeft,
  PhPower as Power,
  PhGearFine as Settings2,
  PhSquare as Square,
  PhSun as Sun,
  PhUser as UserRound,
  PhX as X,
} from "@phosphor-icons/vue";
import { DropdownMenu } from "@vynel/ui";
import type { MenuItemModel } from "@vynel/ui";
import { useWindowControls } from "../../composables/shell/use-window-controls.js";
import { shortcutHint } from "../../utils/shortcut-label.js";

// The desktop title bar with an integrated menu (the Windows 11 / VS Code
// pattern — one bar carries identity, menus, window title, presence, the
// Tabs|Menu navigation-mode segment, and the window controls). Workspace
// navigation itself lives on the strip (tabs mode) or the sidebar tree (menu
// mode). Data-blind: it renders menus + emits `command`; the shell decides
// what each id does. Window controls drive the frameless Tauri window (no-op
// in the browser).
const props = defineProps<{
  theme: "dark" | "light";
  navMode: "tabs" | "menu";
  sidebarOpen: boolean;
  tasksOpen: boolean;
}>();

// The workspace-navigation views — a labeled segment, not a blind toggle, so
// the off mode stays discoverable (the design's Tabs | Menu pair).
const NAV_MODES = [
  { id: "nav-tabs", mode: "tabs", label: "Tabs", icon: Browsers },
  { id: "nav-menu", mode: "menu", label: "Menu", icon: List },
] as const;

const emit = defineEmits<{
  command: [id: string];
  /** True while any menu-bar dropdown is open — the shell's native browser
   *  webview yields, since portaled menu content can reach the page area. */
  "menus-open": [open: boolean];
}>();

const controls = useWindowControls();

const openMenuCount = ref(0);
function onMenuOpenChange(open: boolean) {
  openMenuCount.value = Math.max(0, openMenuCount.value + (open ? 1 : -1));
  emit("menus-open", openMenuCount.value > 0);
}

// Two menus only (Chad's cleanup, 2026-07-24): Vynel = the app (create,
// settings, account, quit); View = how the window looks, each row wearing an
// icon of what it changes. Navigation rows (Sessions, tasks) left the bar —
// the tab strip + sidebar ARE the navigation, and the tasks dock has its own
// title-bar button.
const menus = computed<{ label: string; items: MenuItemModel[] }[]>(() => [
  {
    label: "Vynel",
    items: [
      {
        id: "new-workspace",
        label: "New workspace",
        shortcut: shortcutHint("N", { shift: true }),
        icon: FolderPlus,
      },
      { id: "sep-1", kind: "separator" },
      { id: "settings", label: "Settings", shortcut: shortcutHint(","), icon: Settings2 },
      { id: "account", label: "Account", icon: UserRound },
      { id: "sep-2", kind: "separator" },
      {
        id: "quit",
        label: "Quit Vynel",
        shortcut: shortcutHint("Q"),
        icon: Power,
        danger: true,
      },
    ],
  },
  {
    label: "View",
    items: [
      {
        id: "toggle-sidebar",
        kind: "checkbox",
        label: "Show navigation",
        checked: props.sidebarOpen,
        icon: PanelLeft,
      },
      { id: "sep-3", kind: "separator" },
      {
        id: "toggle-theme",
        label: props.theme === "dark" ? "Light theme" : "Dark theme",
        icon: props.theme === "dark" ? Sun : Moon,
      },
      { id: "sep-4", kind: "separator" },
      {
        id: "command-palette",
        label: "Command palette",
        shortcut: shortcutHint("K"),
        icon: Command,
      },
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
    class="flex h-[34px] shrink-0 items-center gap-0.5 border-b border-hair bg-chrome pl-2 pr-0 select-none"
    data-tauri-drag-region
  >
    <!-- Identity mark — the canvas's accent diamonds-four. -->
    <span class="mr-1 grid size-6 shrink-0 place-items-center rounded-sm text-[var(--color-accent)]">
      <DiamondsFour :size="15" weight="regular" />
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
        @update:open="onMenuOpenChange"
      >
        <template #trigger>
          <button
            type="button"
            class="rounded-sm px-2 py-0.5 text-[12px] text-ink-2 transition hover:bg-row-hover hover:text-ink-1 data-[state=open]:bg-row-active data-[state=open]:text-ink-1"
          >
            {{ menu.label }}
          </button>
        </template>
      </DropdownMenu>
    </nav>

    <!-- Center: pure drag region — the canvas's bar carries nothing here
         (title + presence dot both retired; the tabs/tree/rail say where
         you are and what's live). -->
    <div class="flex-1" data-tauri-drag-region />

    <!-- Workspace navigation mode (Tabs | Menu) — the canvas's segment: the
         active mode wears the accent border + tinted ground. Presentation
         only; the scope-tab state underneath is shared. -->
    <div
      class="mr-2 flex shrink-0 items-center gap-[5px] self-center"
      role="group"
      aria-label="Navigation mode"
    >
      <button
        v-for="entry in NAV_MODES"
        :key="entry.id"
        type="button"
        :aria-pressed="props.navMode === entry.mode"
        :title="`${entry.label} navigation`"
        class="flex items-center gap-1.5 rounded-sm border px-2 py-[3px] text-[11px] transition"
        :class="
          props.navMode === entry.mode
            ? 'border-[var(--color-accent)] bg-[var(--color-accent-900)] text-[var(--color-accent-100)]'
            : 'border-transparent text-[var(--color-neutral-500)] hover:text-[var(--color-accent-200)]'
        "
        @click="emit('command', entry.id)"
      >
        <component :is="entry.icon" :size="12" />
        {{ entry.label }}
      </button>
    </div>

    <!-- The canvas's right icon row: list-checks (the rail toggle) rides the
         SAME 18px-gap, 13px cluster as the window controls — plain glyphs,
         no boxes, no badge. -->
    <div class="flex shrink-0 items-center gap-[18px] pl-1.5 pr-3 text-[13px]">
      <button
        type="button"
        aria-label="Toggle tasks"
        title="Show tasks"
        class="grid place-items-center transition"
        :class="
          props.tasksOpen
            ? 'text-[var(--color-accent-200)]'
            : 'text-ink-3 hover:text-ink-1'
        "
        @click="emit('command', 'toggle-tasks')"
      >
        <ListChecks :size="13" />
      </button>
      <button
        type="button"
        aria-label="Minimize"
        class="grid place-items-center text-ink-3 transition hover:text-ink-1"
        @click="controls.minimize()"
      >
        <Minus :size="13" />
      </button>
      <button
        type="button"
        :aria-label="controls.isMaximized.value ? 'Restore' : 'Maximize'"
        class="grid place-items-center text-ink-3 transition hover:text-ink-1"
        @click="controls.toggleMaximize()"
      >
        <Square :size="13" />
      </button>
      <button
        type="button"
        aria-label="Close"
        class="grid place-items-center text-ink-3 transition hover:text-[var(--danger)]"
        @click="controls.close()"
      >
        <X :size="13" />
      </button>
    </div>
  </header>
</template>
