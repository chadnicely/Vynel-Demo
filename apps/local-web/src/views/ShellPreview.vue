<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  PhCalendarDots as CalendarClock,
  PhTreeView as FolderTree,
  PhClockCounterClockwise as History,
  PhBroadcast as Radio,
  PhSparkle as Sparkles,
} from "@phosphor-icons/vue";
import {
  CommandPalette,
  EmptyState,
  ResizablePanel,
  SegmentedTabs,
} from "@vynel/ui";
import type { CommandItem } from "@vynel/ui";
import AppTitleBar from "../components/shell/AppTitleBar.vue";
import AppTabStrip from "../components/shell/AppTabStrip.vue";
import AppSidebar from "../components/shell/AppSidebar.vue";
import { useUiStore } from "../stores/ui-store.js";

// Wave B scaffold — the reinvented shell assembled from the real chrome
// components, on placeholder content, so the layout/behavior can be reviewed
// before it replaces App.vue.
const ui = useUiStore();

const workspaces = [
  { id: "w1", name: "Growth Hacking" },
  { id: "w2", name: "Letterman" },
  { id: "w3", name: "Personal" },
];
const surface = ref<"home" | "chat" | "workspace">("chat");
const activeWorkspaceId = ref<string | null>(null);
const activeWorkspaceName = computed(
  () => workspaces.find((w) => w.id === activeWorkspaceId.value)?.name ?? null,
);
const accountName = "Chad Subedi";

// The preview's stand-in tab strip — a pinned Global tab plus one tab per
// selected room, mirroring the real shell's wiring shape.
const previewTabs = ref<
  { id: string; workspaceId: string | null; colorSlot: number | null }[]
>([{ id: "global", workspaceId: null, colorSlot: null }]);
const activeTabId = ref("global");

function selectTab(tabId: string) {
  activeTabId.value = tabId;
  const workspaceId = previewTabs.value.find((t) => t.id === tabId)
    ?.workspaceId;
  if (workspaceId != null) selectWorkspace(workspaceId);
  else selectSurface("chat");
}
function closeTab(tabId: string) {
  previewTabs.value = previewTabs.value.filter((t) => t.id !== tabId);
  if (activeTabId.value === tabId) selectTab("global");
}
function addTab(workspaceId: string) {
  const tab = {
    id: `tab-${workspaceId}-${previewTabs.value.length}`,
    workspaceId,
    colorSlot: null,
  };
  previewTabs.value.push(tab);
  activeTabId.value = tab.id;
  selectWorkspace(workspaceId);
}
function retargetTab(tabId: string, workspaceId: string) {
  const tab = previewTabs.value.find((t) => t.id === tabId);
  if (tab) tab.workspaceId = workspaceId;
  if (activeTabId.value === tabId) selectWorkspace(workspaceId);
}
function colorTab(tabId: string, colorSlot: number | null) {
  const tab = previewTabs.value.find((t) => t.id === tabId);
  if (tab) tab.colorSlot = colorSlot;
}

const contextTitle = computed(() =>
  surface.value === "workspace"
    ? (activeWorkspaceName.value ?? "Workspace")
    : surface.value === "home"
      ? "Home"
      : "Global chat",
);
const sectionTitle = computed(() =>
  surface.value === "workspace"
    ? (activeWorkspaceName.value ?? "Workspace")
    : "Menu",
);

function selectSurface(id: string) {
  surface.value = id as "home" | "chat" | "workspace";
  if (id !== "workspace") activeWorkspaceId.value = null;
  lastAction.value = `surface: ${id}`;
}
function selectWorkspace(id: string) {
  surface.value = "workspace";
  activeWorkspaceId.value = id;
  lastAction.value = `workspace: ${activeWorkspaceName.value}`;
}

const sectionItems = [
  { id: "channels", label: "Channels", icon: Radio },
  { id: "schedules", label: "Schedules", icon: CalendarClock },
  { id: "knowledge", label: "Knowledge", icon: FolderTree },
  { id: "memory", label: "Memory", icon: Sparkles },
];
const activeSection = ref<string | null>(null);

const sidebarOpen = ref(true);
const dockOpen = ref(true);
const isPaletteOpen = ref(false);
const lastAction = ref("—");
const dockTab = ref("history");
const dockTabs = [
  { id: "history", label: "History" },
  { id: "files", label: "Files" },
  { id: "trace", label: "Trace" },
];

const presenceState = ref<"idle" | "live" | "attention">("idle");
const contextLabel = computed(
  () => `${presenceState.value} · Global · Sonnet · memory ready`,
);

const commands: CommandItem[] = [
  { id: "new-chat", label: "New chat", group: "Assistant", shortcut: "⌘N" },
  { id: "new-workspace", label: "New workspace", group: "Assistant" },
  { id: "toggle-theme", label: "Toggle theme", group: "View", keywords: "dark light" },
  { id: "toggle-sidebar", label: "Toggle navigation", group: "View" },
  { id: "go-home", label: "Go to Home", group: "Go" },
  { id: "go-chat", label: "Go to Chat", group: "Go" },
  { id: "go-workspace", label: "Go to Workspace", group: "Go" },
];

function runCommand(id: string) {
  lastAction.value = id;
  if (id === "toggle-theme") ui.toggleTheme();
  else if (id === "command-palette") isPaletteOpen.value = true;
  else if (id === "toggle-sidebar") sidebarOpen.value = !sidebarOpen.value;
  else if (id === "go-home") selectSurface("home");
  else if (id === "go-chat") selectSurface("chat");
  else if (id === "go-workspace") selectWorkspace(workspaces[0]!.id);
}

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
    <AppTitleBar
      :title="contextTitle"
      :presence-state="presenceState"
      presence-label="assistant idle"
      :theme="ui.theme"
      nav-mode="tabs"
      :sidebar-open="sidebarOpen"
      :tasks-open="false"
      :open-task-count="3"
      @command="runCommand"
    />

    <AppTabStrip
      :tabs="previewTabs"
      :active-tab-id="activeTabId"
      :workspaces="workspaces"
      @select-tab="selectTab"
      @close-tab="closeTab"
      @retarget-tab="retargetTab"
      @color-tab="colorTab"
      @add-tab="addTab"
      @create-workspace="lastAction = 'create-workspace'"
    />

    <div class="flex min-h-0 flex-1">
      <ResizablePanel
        v-if="sidebarOpen"
        side="left"
        storage-key="shell-preview.nav.width"
        :default-width="230"
      >
        <AppSidebar
          :section-title="sectionTitle"
          :section-items="sectionItems"
          :active-section-id="activeSection"
          :account-name="accountName"
          @select-section="(id) => (activeSection = id)"
          @open-account="lastAction = 'open-account'"
        />
      </ResizablePanel>

      <main class="min-w-0 flex-1 overflow-y-auto">
        <div class="mx-auto flex max-w-2xl flex-col gap-4 p-10">
          <EmptyState
            :title="`Canvas — ${contextTitle}`"
            hint="This is where the thread, a feature section, or the file editor renders. The chrome around it is the reinvented shell."
          >
            <template #icon><Sparkles :size="22" /></template>
          </EmptyState>
          <p class="text-center text-xs text-ink-3">
            ⌘K for the command palette · drag the dividers · last action:
            <span class="text-gold">{{ lastAction }}</span>
          </p>
          <div class="flex justify-center gap-2">
            <button
              v-for="state in (['idle', 'live', 'attention'] as const)"
              :key="state"
              type="button"
              class="cursor-default rounded-sm border border-hair px-2.5 py-1 text-xs text-ink-2 transition hover:border-hair-strong hover:text-ink-1"
              :class="presenceState === state ? 'border-hair-strong text-ink-1' : ''"
              @click="presenceState = state"
            >
              presence: {{ state }}
            </button>
          </div>
        </div>
      </main>

      <ResizablePanel
        v-if="dockOpen"
        side="right"
        storage-key="shell-preview.dock.width"
        :default-width="300"
      >
        <div class="flex h-full flex-col bg-panel">
          <div class="border-b border-hair p-2">
            <SegmentedTabs v-model="dockTab" :tabs="dockTabs" />
          </div>
          <div class="flex flex-1 items-center justify-center p-4 text-xs text-ink-3">
            <span class="flex items-center gap-1.5">
              <History v-if="dockTab === 'history'" :size="14" />
              <FolderTree v-else-if="dockTab === 'files'" :size="14" />
              <Radio v-else :size="14" />
              {{ dockTab }} dock
            </span>
          </div>
        </div>
      </ResizablePanel>
    </div>

    <CommandPalette
      v-model:open="isPaletteOpen"
      :commands="commands"
      @select="runCommand"
    />
  </div>
</template>
