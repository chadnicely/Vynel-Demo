<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  Bot,
  BookOpen,
  Brain,
  CalendarClock,
  FolderTree,
  ListChecks,
  Radio,
  Settings2,
  Store,
  UserRound,
  Wrench,
} from "lucide-vue-next";
import { CommandPalette, ResizablePanel } from "@vynel/ui";
import type { CommandItem } from "@vynel/ui";
import AppTitleBar from "./AppTitleBar.vue";
import AppSidebar from "./AppSidebar.vue";
import type { SidebarItem } from "./AppSidebar.vue";
import AppStatusBar from "./AppStatusBar.vue";
import ApprovalNotifier from "./ApprovalNotifier.vue";
import VoiceOverlay from "../voice/VoiceOverlay.vue";
import SessionViewerPanel from "../session-viewer/SessionViewerPanel.vue";
import CreateWorkspaceDialog from "../workspace/CreateWorkspaceDialog.vue";
import { WORKSPACE_SECTIONS } from "../workspace/workspace-sections.js";
import { useUiStore } from "../../stores/ui-store.js";
import { useActivityStore } from "../../stores/activity-store.js";
import { useWorkspaceList } from "../../composables/workspaces/use-workspace-list.js";
import { useCurrentUser } from "../../composables/users/use-current-user.js";
import { usePendingApprovals } from "../../composables/approvals/use-pending-approvals.js";
import { useTasks } from "../../composables/tasks/use-tasks.js";
import type { WorkspaceResponse } from "@vynel/contracts/workspaces/workspace-http";

// The reinvented desktop shell — mounted only for real surfaces (App.vue keeps
// bare routes and the onboarding wizard out of here, so the /jarvis overlay
// never pays for the shell's data hooks). Navigation writes the shared ui-store
// + route; the routed view reacts.
const route = useRoute();
const router = useRouter();

const ui = useUiStore();
const activity = useActivityStore();
const workspacesQuery = useWorkspaceList();
const currentUserQuery = useCurrentUser();
const pendingApprovalsQuery = usePendingApprovals();

const surface = computed<"home" | "chat" | "workspace">(() => {
  const name = route.name;
  return name === "home" || name === "workspace" ? name : "chat";
});
const scopeShell = computed(() =>
  surface.value === "workspace" ? ui.workspaceChat : ui.globalChat,
);

const activeWorkspaces = computed(() =>
  (workspacesQuery.data.value ?? []).filter((w) => !w.isArchived),
);
const switcherWorkspaces = computed(() =>
  activeWorkspaces.value.map((w) => ({ id: w.id, name: w.name })),
);
const activeWorkspaceName = computed(
  () =>
    activeWorkspaces.value.find((w) => w.id === ui.activeWorkspaceId)?.name ??
    null,
);
const barWorkspaceId = computed(() =>
  surface.value === "workspace" ? ui.activeWorkspaceId : null,
);

const contextTitle = computed(() => {
  if (surface.value === "home") return "Home";
  if (surface.value === "workspace")
    return activeWorkspaceName.value ?? "Workspace";
  return "Global chat";
});

const pendingCount = computed(
  () => pendingApprovalsQuery.data.value?.length ?? 0,
);
const presenceState = computed<"idle" | "live" | "attention">(() => {
  if (pendingCount.value > 0) return "attention";
  if (activity.isTurnRunning) return "live";
  return "idle";
});
const presenceLabel = computed(() => {
  if (pendingCount.value > 0)
    return `${pendingCount.value} approval${pendingCount.value === 1 ? "" : "s"} waiting`;
  if (activity.isTurnRunning) return "assistant working";
  return "assistant idle";
});
const statusContext = computed(
  () => `${presenceLabel.value} · ${contextTitle.value}`,
);

const accountName = computed(
  () => currentUserQuery.data.value?.displayName ?? "Your account",
);

// Open work feeds the title bar's tasks-toggle badge (the same list every
// tasks surface reads — vue-query dedupes the fetch).
const tasksQuery = useTasks(true);
const openTaskCount = computed(
  () =>
    (tasksQuery.data.value ?? []).filter((row) => row.status !== "done")
      .length,
);

// ── Sidebar sections (contextual to the scope). Icons come from the app so
// @vynel/ui stays icon-set-free. ──
const GLOBAL_SECTIONS: SidebarItem[] = [
  { id: "channels", label: "Channels", icon: Radio },
  { id: "schedules", label: "Schedules", icon: CalendarClock },
  { id: "tasks", label: "Tasks", icon: ListChecks },
  { id: "knowledge", label: "Knowledge", icon: FolderTree },
  { id: "memory", label: "Memory", icon: Brain },
  { id: "notebook", label: "Notebook", icon: BookOpen },
  { id: "marketplace", label: "Marketplace", icon: Store },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "account", label: "Account", icon: UserRound },
  { id: "application", label: "Application", icon: Settings2 },
];
const WORKSPACE_SECTION_ICONS: Record<string, SidebarItem["icon"]> = {
  skills: Wrench,
  channels: Radio,
  schedules: CalendarClock,
  tasks: ListChecks,
  knowledge: FolderTree,
  marketplace: Store,
  memory: Brain,
  notebook: BookOpen,
  agents: Bot,
};
const WORKSPACE_SECTION_IDS = new Set<string>(
  WORKSPACE_SECTIONS.map((s) => s.id),
);
const WORKSPACE_SECTION_ITEMS: SidebarItem[] = WORKSPACE_SECTIONS.map(
  (section) => {
    const icon = WORKSPACE_SECTION_ICONS[section.id];
    return icon
      ? { id: section.id, label: section.label, icon }
      : { id: section.id, label: section.label };
  },
);
const sectionItems = computed(() =>
  surface.value === "workspace" ? WORKSPACE_SECTION_ITEMS : GLOBAL_SECTIONS,
);
const sectionTitle = computed(() =>
  surface.value === "workspace"
    ? (activeWorkspaceName.value ?? "Workspace")
    : "Menu",
);
const activeSectionId = computed(() => {
  if (surface.value === "home") return null;
  const view = scopeShell.value.mainView;
  return typeof view === "string" && view !== "chat" ? view : null;
});

// ── Navigation handlers (write shared ui-store + route; the views react). ──
function selectSurface(id: string) {
  if (id === "home") {
    void router.push({ name: "home" });
  } else {
    ui.globalChat.mainView = "chat";
    void router.push({ name: "chat" });
  }
}
function selectWorkspace(id: string) {
  ui.activeWorkspaceId = id;
  ui.workspaceChat.mainView = "chat";
  void router.push({ name: "workspace" });
}
function selectGlobal() {
  ui.globalChat.mainView = "chat";
  void router.push({ name: "chat" });
}
// Only the seven workspace sections live on a workspace; global-only views
// (account, application) always route to the global chat surface — otherwise a
// workspace canvas can't render them and silently falls back to the thread.
function selectSection(id: string) {
  if (surface.value === "workspace" && WORKSPACE_SECTION_IDS.has(id)) {
    ui.workspaceChat.mainView = id as typeof ui.workspaceChat.mainView;
  } else {
    ui.globalChat.mainView = id as typeof ui.globalChat.mainView;
    if (route.name !== "chat") void router.push({ name: "chat" });
  }
}
function openAccount() {
  selectSection("account");
}

const isSidebarOpen = ref(true);
const isPaletteOpen = ref(false);
const isCreateWorkspaceOpen = ref(false);

function onWorkspaceCreated(workspace: WorkspaceResponse) {
  isCreateWorkspaceOpen.value = false;
  selectWorkspace(workspace.id);
}

function runCommand(id: string) {
  switch (id) {
    case "toggle-theme":
      ui.toggleTheme();
      break;
    case "command-palette":
      isPaletteOpen.value = true;
      break;
    case "toggle-sidebar":
      isSidebarOpen.value = !isSidebarOpen.value;
      break;
    case "toggle-dock":
      ui.isSessionListOpen = !ui.isSessionListOpen;
      break;
    case "toggle-tasks":
      ui.isTasksPanelOpen = !ui.isTasksPanelOpen;
      break;
    case "go-home":
      void router.push({ name: "home" });
      break;
    case "go-chat":
      selectSurface("chat");
      break;
    case "go-workspace": {
      const first = switcherWorkspaces.value[0];
      if (first) selectWorkspace(first.id);
      break;
    }
    case "new-chat":
      ui.globalChat.target = "fresh";
      ui.globalChat.mainView = "chat";
      void router.push({ name: "chat" });
      break;
    case "new-workspace":
      isCreateWorkspaceOpen.value = true;
      break;
    case "start-voice":
      ui.isVoiceOverlayOpen = true;
      break;
    case "settings":
      selectSection("application");
      break;
    default:
      if (GLOBAL_SECTIONS.some((s) => s.id === id)) selectSection(id);
  }
}

const paletteCommands = computed<CommandItem[]>(() => [
  { id: "new-chat", label: "New chat", group: "Assistant", shortcut: "⌘N" },
  { id: "new-workspace", label: "New workspace", group: "Assistant" },
  { id: "start-voice", label: "Start voice", group: "Assistant" },
  { id: "go-home", label: "Go to Home", group: "Go" },
  { id: "go-chat", label: "Go to Chat", group: "Go" },
  ...switcherWorkspaces.value.map((w) => ({
    id: `ws:${w.id}`,
    label: w.name,
    hint: "Workspace",
    group: "Go",
  })),
  ...GLOBAL_SECTIONS.map((s) =>
    s.icon
      ? { id: s.id, label: s.label, group: "Open", icon: s.icon }
      : { id: s.id, label: s.label, group: "Open" },
  ),
  { id: "toggle-theme", label: "Toggle theme", group: "View", keywords: "dark light" },
  { id: "toggle-sidebar", label: "Toggle navigation", group: "View" },
]);

function onPaletteSelect(id: string) {
  if (id.startsWith("ws:")) selectWorkspace(id.slice(3));
  else runCommand(id);
}

function onGlobalKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    isPaletteOpen.value = true;
  }
}
onMounted(() => window.addEventListener("keydown", onGlobalKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onGlobalKeydown));
</script>

<template>
  <div class="app-shell">
    <AppTitleBar
      :title="contextTitle"
      :presence-state="presenceState"
      :presence-label="presenceLabel"
      :theme="ui.theme"
      :sidebar-open="isSidebarOpen"
      :dock-open="ui.isSessionListOpen"
      :tasks-open="ui.isTasksPanelOpen"
      :open-task-count="openTaskCount"
      :workspaces="switcherWorkspaces"
      :active-workspace-id="barWorkspaceId"
      @command="runCommand"
      @select-workspace="selectWorkspace"
      @select-global="selectGlobal"
      @create-workspace="isCreateWorkspaceOpen = true"
    />

    <div class="app-body">
      <ResizablePanel
        v-if="isSidebarOpen"
        side="left"
        storage-key="vynel.sidebar.width"
        :default-width="240"
        :min-width="200"
        :max-width="380"
      >
        <AppSidebar
          :surface="surface"
          :section-title="sectionTitle"
          :section-items="sectionItems"
          :active-section-id="activeSectionId"
          :account-name="accountName"
          @select-surface="selectSurface"
          @select-section="selectSection"
          @open-account="openAccount"
        />
      </ResizablePanel>

      <main class="canvas-wrap">
        <RouterView />
      </main>
    </div>

    <AppStatusBar
      :presence-state="presenceState"
      :context-label="statusContext"
      :pending-approvals="pendingCount"
      @open-approvals="selectSurface('chat')"
    />

    <SessionViewerPanel />
    <ApprovalNotifier />
    <VoiceOverlay />
    <CreateWorkspaceDialog
      :open="isCreateWorkspaceOpen"
      @close="isCreateWorkspaceOpen = false"
      @created="onWorkspaceCreated"
    />
    <CommandPalette
      v-model:open="isPaletteOpen"
      :commands="paletteCommands"
      @select="onPaletteSelect"
    />
  </div>
</template>

<style scoped>
.app-shell {
  display: grid;
  grid-template-rows: 40px 1fr 22px;
  height: 100vh;
  background: var(--bg-shell);
  color: var(--ink-1);
}

.app-body {
  display: flex;
  min-height: 0;
  overflow: hidden;
}

.canvas-wrap {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
</style>
