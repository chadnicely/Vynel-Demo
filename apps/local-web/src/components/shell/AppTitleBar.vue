<script setup lang="ts">
import { computed, ref } from "vue";
import {
  PhBroadcast as Broadcast,
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
import { ClaudeMark, DropdownMenu } from "@vynel/ui";
import type { MenuItemModel } from "@vynel/ui";
import { useWindowControls } from "../../composables/shell/use-window-controls.js";
import { shortcutHint } from "../../utils/shortcut-label.js";

// The desktop title bar with an integrated menu (the Windows 11 / VS Code
// pattern — one bar carries identity, menus, presence, and the window
// controls). Workspace navigation itself lives on the strip (tabs mode) or
// the sidebar tree (menu mode), and the pick between the two is a View-menu
// row (Kafi, 2026-08-21 — the standing Tabs|Menu segment left the bar).
// Data-blind: it renders menus + emits `command`; the shell decides what each
// id does. Window controls drive the frameless Tauri window (no-op in the
// browser).
const props = withDefaults(
  defineProps<{
  theme: "dark" | "light";
  navMode: "tabs" | "menu";
  sidebarOpen: boolean;
  tasksOpen: boolean;
  /** True where the scope has no pane-tool cluster of its own (Global). A
   *  workspace puts the rail toggle beside its files toggle, so the bar must
   *  not carry a second one. */
  showsTasksToggle?: boolean;
  /** The Display room is on screen right now — the switch lights with it. */
  displayOn?: boolean;
  }>(),
  // Explicit, not merely absent: Vue casts an unpassed boolean prop to false,
  // which would silently strip the toggle from a bar that never opted out.
  { showsTasksToggle: true, displayOn: false },
);

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
      // The workspace-navigation views, both named so the off mode stays
      // discoverable — the segment's whole point, now the menu's top pair.
      // Ticking the live one is a no-op; the shell early-returns.
      {
        id: "nav-tabs",
        kind: "checkbox",
        label: "Tabs",
        checked: props.navMode === "tabs",
        icon: Browsers,
      },
      {
        id: "nav-menu",
        kind: "checkbox",
        label: "Menu",
        checked: props.navMode === "menu",
        icon: List,
      },
      { id: "sep-3", kind: "separator" },
      {
        id: "toggle-sidebar",
        kind: "checkbox",
        label: "Show navigation",
        checked: props.sidebarOpen,
        icon: PanelLeft,
      },
      { id: "sep-4", kind: "separator" },
      {
        id: "toggle-theme",
        label: props.theme === "dark" ? "Light theme" : "Dark theme",
        icon: props.theme === "dark" ? Sun : Moon,
      },
      { id: "sep-5", kind: "separator" },
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
      <!-- The whole fleet's node screen, one word away (Chad, 2026-08-11):
           a direct link, not a menu — the project rooms carry their own
           quieter icons for their own nodes. Wears the menu triggers' own
           classes so it sits flush with them rather than proud of them. -->
      <button
        type="button"
        class="rounded-sm px-2 py-0.5 text-[12px] text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
        @click="emit('command', 'open-nodes')"
      >
        Nodes
      </button>
    </nav>

    <!-- Center: pure drag region — the canvas's bar carries nothing here
         (title + presence dot both retired; the tabs/tree/rail say where
         you are and what's live). -->
    <div class="flex-1" data-tauri-drag-region />

    <!-- The provider mark (Kafi, 2026-08-18): whose engine this machine runs
         on — the Claude account popup's door, first of the right cluster.
         Identity coral, never gold (presence). -->
    <button
      type="button"
      aria-label="Claude account"
      title="Claude account"
      class="mr-2 grid size-6 shrink-0 place-items-center self-center rounded-sm text-[var(--claude-mark)] transition hover:bg-row-hover"
      @click="emit('command', 'claude-account')"
    >
      <ClaudeMark :size="13" />
    </button>

    <!-- The canvas's right icon row: plain glyphs at 13px on an 18px gap. The
         rail toggle only appears where the scope has no pane tools of its own
         — a workspace keeps it beside its files toggle instead. -->
    <div class="flex shrink-0 items-center gap-[18px] pl-1.5 pr-3 text-[13px]">
      <!-- The Display switch: the orb room, and with it the microphone. It
           sits on every scope (the room is global) and leads the row — the
           window controls stay rightmost. -->
      <button
        type="button"
        aria-label="Toggle Display"
        :title="props.displayOn ? 'Close Display' : 'Open Display'"
        :aria-pressed="props.displayOn"
        class="grid place-items-center transition"
        :class="
          props.displayOn
            ? 'text-[var(--color-accent-200)]'
            : 'text-ink-3 hover:text-ink-1'
        "
        @click="emit('command', 'toggle-display')"
      >
        <Broadcast :size="13" />
      </button>
      <button
        v-if="props.showsTasksToggle"
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
