<script setup lang="ts">
import { computed, ref } from "vue";
import {
  PhCommand as Command,
  PhFolderPlus as FolderPlus,
  PhListChecks as ListChecks,
  PhMoon as Moon,
  PhSidebarSimple as PanelLeft,
  PhPower as Power,
  PhGearFine as Settings2,
  PhSun as Sun,
  PhUser as UserRound,
} from "@phosphor-icons/vue";
import { DropdownMenu, PresenceDot } from "@vynel/ui";
import type { MenuItemModel } from "@vynel/ui";
import { useWindowControls } from "../../composables/shell/use-window-controls.js";
import { shortcutHint } from "../../utils/shortcut-label.js";

// The desktop title bar with an integrated menu (the Windows 11 / VS Code
// pattern — one bar carries identity, menus, window title, presence, and the
// window controls). Workspace navigation lives on the tab strip below, not
// here. Data-blind: it renders menus + emits `command`; the shell decides
// what each id does. Window controls drive the frameless Tauri window (no-op
// in the browser).
const props = defineProps<{
  title: string;
  presenceState: "idle" | "live" | "attention";
  presenceLabel: string;
  theme: "dark" | "light";
  sidebarOpen: boolean;
  tasksOpen: boolean;
  openTaskCount: number;
}>();

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
        @update:open="onMenuOpenChange"
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

    <!-- Center: window title + presence (the drag region). The presence pair
         is a BUTTON (no-drag island): it opens the Background overview —
         the dot says something is running; the click shows what. -->
    <div
      class="flex flex-1 items-center justify-center gap-2 px-4"
      data-tauri-drag-region
    >
      <!-- The presence pair is PASSIVE now (redesign Q7d): the working rail
           is the detail — the dot only says live / attention / idle. It
           survives because your OWN turn's approval can need you while the
           rail is empty. -->
      <span
        class="flex items-center gap-2 px-2 py-0.5"
        data-testid="titlebar-presence"
      >
        <PresenceDot :state="props.presenceState" :label="props.presenceLabel" />
        <span class="truncate text-xs text-ink-2">{{ props.title }}</span>
      </span>
    </div>

    <!-- The tasks dock toggle (Chad's right-side icon) — badge counts open work. -->
    <button
      type="button"
      aria-label="Toggle tasks"
      class="relative mr-1 grid size-7 shrink-0 place-items-center self-center rounded-sm transition hover:bg-row-hover hover:text-ink-1"
      :class="props.tasksOpen ? 'bg-row-active text-ink-1' : 'text-ink-3'"
      title="Show tasks"
      @click="emit('command', 'toggle-tasks')"
    >
      <ListChecks :size="15" />
      <span
        v-if="props.openTaskCount > 0"
        class="task-count-badge absolute -right-0.5 -top-0.5 grid min-w-[14px] place-items-center rounded-full bg-info px-1 text-[9px] font-bold leading-[14px] text-white"
      >
        {{ props.openTaskCount > 9 ? "9+" : props.openTaskCount }}
      </span>
    </button>

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
