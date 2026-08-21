<script setup lang="ts">
import { computed, ref } from "vue";
import {
  PhBrowsers as Browsers,
  PhCommand as Command,
  PhCpu as Cpu,
  PhDiamondsFour as DiamondsFour,
  PhFolderPlus as FolderPlus,
  PhGraph as Graph,
  PhList as List,
  PhListChecks as ListChecks,
  PhMinus as Minus,
  PhMoon as Moon,
  PhSidebarSimple as PanelLeft,
  PhPower as Power,
  PhGearFine as Settings2,
  PhSpeakerHigh as SpeakerHigh,
  PhSquare as Square,
  PhSun as Sun,
  PhUser as UserRound,
  PhX as X,
} from "@phosphor-icons/vue";
import { ClaudeMark, DropdownMenu } from "@vynel/ui";
import type { MenuItemModel } from "@vynel/ui";
import ViewModeSwitch from "./ViewModeSwitch.vue";
import type { ViewMode } from "../../composables/shell/use-view-mode.js";
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
//
// Full view (Kafi, 2026-08-22): the Nodes screen or the Display fills the
// window and the bar collapses to its corner cluster — the view switch, the
// provider mark and the window controls — floating over the view's own top
// strip. The mark, the menus and the bar's ground all go; nothing else moves,
// so the normal view is exactly what it always was.
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
  /** The Display feature holds this window's voice — the switch's Display
   *  segment glows with it, on screen or running behind another view. */
  displayOn?: boolean;
  /** What the window is showing, as the switch reads it back. */
  viewMode?: ViewMode;
  /** The view fills the window — the bar is its corner cluster only. */
  fullView?: boolean;
  }>(),
  // Explicit, not merely absent: Vue casts an unpassed boolean prop to false,
  // which would silently strip the toggle from a bar that never opted out.
  { showsTasksToggle: true, displayOn: false, viewMode: "normal", fullView: false },
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

// Three menus (Chad's cleanup, 2026-07-24, + Settings on 2026-08-22): Vynel =
// the app (create, account, quit); Settings = this computer's machine-level
// screens (Kafi: Embedding · Voice · Where Vynel runs · Application — moved
// here from the sidebar); View = how the window looks, each row wearing an
// icon of what it changes. Navigation rows (Sessions, tasks) left the bar —
// the tab strip + sidebar ARE the navigation, and the tasks dock has its own
// title-bar button. The Nodes word left too (2026-08-22): the view switch's
// Nodes segment is its one door now.
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
    label: "Settings",
    items: [
      { id: "embedding", label: "Embedding", icon: Graph },
      { id: "voice-settings", label: "Voice", icon: SpeakerHigh },
      { id: "sep-settings", kind: "separator" },
      { id: "engine", label: "Where Vynel runs", icon: Cpu },
      {
        id: "application",
        label: "Application",
        shortcut: shortcutHint(","),
        icon: Settings2,
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

// Each segment is a command the shell already knows — Nodes rides the same
// `open-nodes` the title-bar word used to send.
const VIEW_COMMANDS: Record<ViewMode, string> = {
  nodes: "open-nodes",
  display: "view-display",
  normal: "view-normal",
};

// Over the Display the corner cluster reads in the Display's own palette —
// the app's chrome greys would vanish into its ground (or, in the light theme,
// sit as dark smudges on it).
const wearsDisplayPalette = computed(() => props.fullView && props.viewMode === "display");
</script>

<template>
  <header
    class="flex h-[34px] shrink-0 items-center gap-0.5 pr-0 select-none"
    :class="[
      props.fullView
        ? 'absolute right-0 top-0 z-20 bg-transparent'
        : 'border-b border-hair bg-chrome pl-2',
      wearsDisplayPalette ? 'display-palette corner-on-display' : '',
    ]"
    data-tauri-drag-region
  >
    <template v-if="!props.fullView">
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
    </template>

    <!-- The view switch (Kafi, 2026-08-22): Nodes | Display | Normal, first of
         the right cluster, just before the provider mark. Its Display segment
         carries what the Broadcast glyph used to — the room, and with it the
         microphone. -->
    <ViewModeSwitch
      class="mr-2"
      :mode="props.viewMode"
      :display-live="props.displayOn"
      :full-view="props.fullView"
      @pick="(mode) => emit('command', VIEW_COMMANDS[mode])"
      @toggle-full-view="emit('command', 'toggle-full-view')"
    />

    <!-- The provider mark (Kafi, 2026-08-18): whose engine this machine runs
         on — the Claude account popup's door. Identity coral, never gold
         (presence). -->
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
      <button
        v-if="props.showsTasksToggle && !props.fullView"
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
        class="window-control grid place-items-center text-ink-3 transition hover:text-ink-1"
        @click="controls.minimize()"
      >
        <Minus :size="13" />
      </button>
      <button
        type="button"
        :aria-label="controls.isMaximized.value ? 'Restore' : 'Maximize'"
        class="window-control grid place-items-center text-ink-3 transition hover:text-ink-1"
        @click="controls.toggleMaximize()"
      >
        <Square :size="13" />
      </button>
      <button
        type="button"
        aria-label="Close"
        class="window-control grid place-items-center text-ink-3 transition hover:text-[var(--danger)]"
        @click="controls.close()"
      >
        <X :size="13" />
      </button>
    </div>
  </header>
</template>

<style scoped>
/* The window controls over the Display: the palette's dim accent, brightening
   to its text on hover — the same two values the room's own pills use. */
.corner-on-display .window-control {
  color: var(--display-accent-dim);
}

.corner-on-display .window-control:hover {
  color: var(--display-text);
}
</style>
