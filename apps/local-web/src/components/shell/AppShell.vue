<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  Bot,
  BookOpen,
  Brain,
  CalendarClock,
  CalendarRange,
  FolderTree,
  History,
  House,
  ListChecks,
  MessageCircle,
  NotebookPen,
  Radio,
  Server,
  Settings2,
  SquarePlay,
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
import AskNotifier from "../asks/AskNotifier.vue";
import VoiceOverlay from "../voice/VoiceOverlay.vue";
import ActivityMonitorPanel from "../activity/ActivityMonitorPanel.vue";
import CreateWorkspaceDialog from "../workspace/CreateWorkspaceDialog.vue";
import { WORKSPACE_SECTIONS } from "../workspace/workspace-sections.js";
import { useUiStore } from "../../stores/ui-store.js";
import { useActivityStore } from "../../stores/activity-store.js";
import { useWorkspaceList } from "../../composables/workspaces/use-workspace-list.js";
import { useCurrentUser } from "../../composables/users/use-current-user.js";
import { usePendingApprovals } from "../../composables/approvals/use-pending-approvals.js";
import { useSessionActivityFeed } from "../../composables/activity/use-session-activity-feed.js";
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
// The app's single /activity/stream subscription — server-reported turns
// (Telegram, another tab, schedule fires) fold into the activity store so the
// chat views go live and the presence dot lights for background work.
useSessionActivityFeed();

const surface = computed<"home" | "chat" | "sessions" | "workspace">(() => {
  const name = route.name;
  return name === "home" || name === "workspace" || name === "sessions"
    ? name
    : "chat";
});
// The Sessions view's scope rides its query — a workspace-scoped library keeps
// the room's context (switcher, sections) while it's open.
const sessionsWorkspaceId = computed(() =>
  route.name === "sessions" && typeof route.query.workspace === "string"
    ? route.query.workspace
    : null,
);
const inWorkspaceScope = computed(
  () => surface.value === "workspace" || sessionsWorkspaceId.value !== null,
);
const scopeShell = computed(() =>
  inWorkspaceScope.value ? ui.workspaceChat : ui.globalChat,
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
  surface.value === "workspace" ? ui.activeWorkspaceId : sessionsWorkspaceId.value,
);

const contextTitle = computed(() => {
  if (surface.value === "home") return "Home";
  if (surface.value === "sessions") return "Sessions";
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

// ── Sidebar menu (contextual to the scope). Icons come from the app so
// @vynel/ui stays icon-set-free. Home / Chat / Sessions are ORDINARY menu
// items at the top (Chad killed the segmented pill — "no special menus");
// they behave exactly as the pill did, in both scopes. ──
const SURFACE_ITEMS: SidebarItem[] = [
  { id: "home", label: "Home", icon: House },
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "sessions", label: "Sessions", icon: History },
];
const GLOBAL_SECTIONS: SidebarItem[] = [
  { id: "channels", label: "Channels", icon: Radio },
  { id: "schedules", label: "Schedules", icon: CalendarClock },
  { id: "tasks", label: "Tasks", icon: ListChecks },
  { id: "plans", label: "Plans", icon: CalendarRange },
  { id: "journal", label: "Journal", icon: NotebookPen },
  { id: "ssh-servers", label: "Servers", icon: Server },
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
  plans: CalendarRange,
  journal: NotebookPen,
  apps: SquarePlay,
  "ssh-servers": Server,
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
const sectionItems = computed(() => [
  ...SURFACE_ITEMS,
  ...(inWorkspaceScope.value ? WORKSPACE_SECTION_ITEMS : GLOBAL_SECTIONS),
]);
const sectionTitle = computed(() =>
  inWorkspaceScope.value
    ? (activeWorkspaceName.value ?? "Workspace")
    : "Menu",
);
const activeSectionId = computed(() => {
  if (surface.value === "home") return "home";
  if (surface.value === "sessions") return "sessions";
  const view = scopeShell.value.mainView;
  if (typeof view !== "string") return null;
  if (view !== "chat") return view;
  // The thread itself: Chat follows the scope (a room's Chat is ITS continuing
  // conversation), so the global thread AND a workspace thread both mark it.
  return "chat";
});

// ── Navigation handlers (write shared ui-store + route; the views react). ──
function selectSurface(id: string) {
  if (id === "home") {
    void router.push({ name: "home" });
  } else if (id === "sessions") {
    openSessions();
  } else if (inWorkspaceScope.value) {
    // Chat follows the scope: a workspace room's Chat is ITS continuing
    // conversation — never a silent jump to the global thread (Chad,
    // 2026-07-21 live feedback).
    ui.workspaceChat.mainView = "chat";
    void router.push({ name: "workspace" });
  } else {
    ui.globalChat.mainView = "chat";
    void router.push({ name: "chat" });
  }
}

// The library follows where you are: a workspace room's Sessions lists that
// room's sessions (its primary chain + its spawned children); everywhere else
// lists everything.
function openSessions() {
  const workspaceId =
    surface.value === "workspace"
      ? ui.activeWorkspaceId
      : sessionsWorkspaceId.value;
  void router.push({
    name: "sessions",
    ...(workspaceId !== null ? { query: { workspace: workspaceId } } : {}),
  });
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
// Only the workspace sections live on a workspace; global-only views (account,
// application) always route to the global chat surface — otherwise a workspace
// canvas can't render them and silently falls back to the thread. Home / Chat /
// Sessions are ordinary menu rows that route like the old pill did.
function selectSection(id: string) {
  if (id === "home" || id === "chat" || id === "sessions") {
    selectSurface(id);
    return;
  }
  if (inWorkspaceScope.value && WORKSPACE_SECTION_IDS.has(id)) {
    ui.workspaceChat.mainView = id as typeof ui.workspaceChat.mainView;
    if (route.name !== "workspace") void router.push({ name: "workspace" });
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
    case "toggle-tasks":
      ui.isTasksPanelOpen = !ui.isTasksPanelOpen;
      break;
    case "go-home":
      void router.push({ name: "home" });
      break;
    case "go-chat":
      selectSurface("chat");
      break;
    case "go-sessions":
      openSessions();
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
  { id: "go-sessions", label: "Go to Sessions", group: "Go" },
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
          :section-title="sectionTitle"
          :section-items="sectionItems"
          :active-section-id="activeSectionId"
          :account-name="accountName"
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

    <ActivityMonitorPanel />
    <ApprovalNotifier />
    <AskNotifier />
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
