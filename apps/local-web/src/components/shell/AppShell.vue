<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  Bot,
  BookOpen,
  Brain,
  Cable,
  CalendarClock,
  CalendarRange,
  Cpu,
  FolderTree,
  History,
  House,
  ListChecks,
  MessageCircle,
  NotebookPen,
  Radio,
  ScrollText,
  Server,
  Settings2,
  SlidersHorizontal,
  SquarePlay,
  SquareSlash,
  Store,
  UserRound,
  Wrench,
} from "lucide-vue-next";
import { CommandPalette, ResizablePanel, useOpenModalCount } from "@vynel/ui";
import type { CommandItem } from "@vynel/ui";
import AppTitleBar from "./AppTitleBar.vue";
import AppTabStrip from "./AppTabStrip.vue";
import AppSidebar from "./AppSidebar.vue";
import BrowserPanel from "../browser/BrowserPanel.vue";
import type { SidebarItem } from "./AppSidebar.vue";
import AppStatusBar from "./AppStatusBar.vue";
import ApprovalNotifier from "./ApprovalNotifier.vue";
import AskNotifier from "../asks/AskNotifier.vue";
import VoiceOverlay from "../voice/VoiceOverlay.vue";
import ConversationSidebar from "../sidebar/ConversationSidebar.vue";
import WorkingRail from "../rail/WorkingRail.vue";
import CreateWorkspaceDialog from "../workspace/CreateWorkspaceDialog.vue";
import PlanViewDialog from "../plans/PlanViewDialog.vue";
import ReportViewDialog from "../reports/ReportViewDialog.vue";
import { useAppLinkRouter } from "../../composables/use-app-link-router.js";
import { useWindowControls } from "../../composables/shell/use-window-controls.js";
import {
  MENU_GROUP_LABELS,
  WORKSPACE_SECTIONS,
} from "../workspace/workspace-sections.js";
import { GLOBAL_TAB_ID, useUiStore } from "../../stores/ui-store.js";
import {
  GLOBAL_SCOPE_KEY,
  useCustomizeStore,
} from "../../stores/customize-store.js";
import { useScopeTabs } from "../../composables/shell/use-scope-tabs.js";
import { shortcutHint } from "../../utils/shortcut-label.js";
import { useActivityStore } from "../../stores/activity-store.js";
import { useBrowserStore } from "../../stores/browser-store.js";
import { useConversationSidebarStore } from "../../stores/conversation-sidebar-store.js";
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
const browser = useBrowserStore();
// Ctrl/⌘+Q closes the window from anywhere — same controls the title bar drives.
const windowControls = useWindowControls();
// One capture-phase listener for in-app vynel:// links (plan links in
// assistant markdown, anywhere they render).
useAppLinkRouter();
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
// Scope follows the ACTIVE TAB: the pinned Global tab or a workspace room.
// Everything contextual (sidebar menu, session library scope, the canvas
// shell) derives from it.
const inWorkspaceScope = computed(() => ui.activeTab.workspaceId !== null);
const scopeShell = computed(() => ui.activeTab.shell);

const allWorkspaces = computed(() => workspacesQuery.data.value ?? []);
const activeWorkspaces = computed(() =>
  allWorkspaces.value.filter((w) => !w.isArchived),
);
const workspaceOptions = computed(() =>
  activeWorkspaces.value.map((w) => ({ id: w.id, name: w.name })),
);
const activeWorkspaceName = computed(
  () =>
    allWorkspaces.value.find((w) => w.id === ui.activeWorkspaceId)?.name ??
    null,
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
// items at the top; the feature sections render under their catalog groups
// (workspace-sections.ts owns ids, labels, order, and the group story). ──
const SURFACE_ITEMS: SidebarItem[] = [
  { id: "home", label: "Home", icon: House },
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "sessions", label: "Sessions", icon: History },
];
const SECTION_ICONS: Record<string, SidebarItem["icon"]> = {
  agents: Bot,
  skills: Wrench,
  rules: ScrollText,
  commands: SquareSlash,
  "mcp-servers": Cable,
  marketplace: Store,
  channels: Radio,
  schedules: CalendarClock,
  tasks: ListChecks,
  plans: CalendarRange,
  journal: NotebookPen,
  knowledge: FolderTree,
  memory: Brain,
  notebook: BookOpen,
  apps: SquarePlay,
  "ssh-servers": Server,
};
// Apps needs a running project — it has no global surface.
const GLOBAL_HIDDEN_SECTION_IDS = new Set<string>(["apps"]);
// The system rows that aren't features at all — global menu only, after the
// catalog, outside every group.
const GLOBAL_SYSTEM_ITEMS: SidebarItem[] = [
  { id: "engine", label: "Where Vynel runs", icon: Cpu },
  { id: "account", label: "Account", icon: UserRound },
  { id: "application", label: "Application", icon: Settings2 },
];
const WORKSPACE_SECTION_IDS = new Set<string>(
  WORKSPACE_SECTIONS.map((s) => s.id),
);
const SECTION_LABELS = new Map(
  WORKSPACE_SECTIONS.map((section) => [section.id, section.label]),
);
function catalogItems(scope: "global" | "workspace"): SidebarItem[] {
  return WORKSPACE_SECTIONS.filter(
    (section) =>
      scope === "workspace" || !GLOBAL_HIDDEN_SECTION_IDS.has(section.id),
  ).map((section) => {
    const icon = SECTION_ICONS[section.id];
    return {
      id: section.id,
      label: section.label,
      ...(icon !== undefined ? { icon } : {}),
      ...(section.group !== null
        ? {
            group: {
              id: section.group,
              label: MENU_GROUP_LABELS[section.group],
            },
          }
        : {}),
    };
  });
}
// A surface's menu obeys its customization: the user's order, custom
// groups, and hidden sections (visual only — the agent keeps every tool).
// The Customize row itself rides pinned at the end, outside the catalog;
// the Global menu keeps its system rows just before it.
const customize = useCustomizeStore();
const CUSTOMIZE_ITEM: SidebarItem = {
  id: "customize",
  label: "Customize",
  icon: SlidersHorizontal,
};
function customizedMenuItems(scopeKey: string): SidebarItem[] {
  const isGlobal = scopeKey === GLOBAL_SCOPE_KEY;
  const config = customize.customizationFor(scopeKey);
  const groupLabels = new Map(
    config.groups.map((group) => [group.id, group.label]),
  );
  const items: SidebarItem[] = [];
  for (const entry of config.entries) {
    if (entry.isHidden) continue;
    if (isGlobal && GLOBAL_HIDDEN_SECTION_IDS.has(entry.sectionId)) continue;
    const label = SECTION_LABELS.get(entry.sectionId);
    if (label === undefined) continue;
    const icon = SECTION_ICONS[entry.sectionId];
    const groupLabel =
      entry.groupId !== null ? groupLabels.get(entry.groupId) : undefined;
    items.push({
      id: entry.sectionId,
      label,
      ...(icon !== undefined ? { icon } : {}),
      ...(entry.groupId !== null && groupLabel !== undefined
        ? { group: { id: entry.groupId, label: groupLabel } }
        : {}),
    });
  }
  if (isGlobal) items.push(...GLOBAL_SYSTEM_ITEMS);
  items.push(CUSTOMIZE_ITEM);
  return items;
}
// The global menu's DEFAULT full run — the command palette's "Open" group
// and its default routing case read this (the palette ignores menu
// customization: hidden sections stay reachable there by design).
const GLOBAL_MENU_ITEMS: SidebarItem[] = [
  ...catalogItems("global"),
  ...GLOBAL_SYSTEM_ITEMS,
  CUSTOMIZE_ITEM,
];
const sectionItems = computed(() => {
  const workspaceId = ui.activeTab.workspaceId;
  return [
    ...SURFACE_ITEMS,
    ...customizedMenuItems(workspaceId ?? GLOBAL_SCOPE_KEY),
  ];
});

// The strip needs every workspace's customized accent, not just the active
// tab's — each tab colors itself.
const workspaceColorSlots = computed<Record<string, number | null>>(() => {
  const slots: Record<string, number | null> = {};
  for (const [workspaceId, config] of Object.entries(customize.byWorkspace)) {
    slots[workspaceId] = config.colorSlot;
  }
  return slots;
});

// Hiding the section that's currently on the canvas bounces it to Chat —
// otherwise the panel would render a view the menu no longer admits to.
watch(
  () => {
    const view = ui.activeTab.shell.mainView;
    if (typeof view !== "string") return false;
    return customize
      .customizationFor(ui.activeTab.workspaceId ?? GLOBAL_SCOPE_KEY)
      .entries.some((entry) => entry.sectionId === view && entry.isHidden);
  },
  (isActiveSectionHidden) => {
    if (isActiveSectionHidden) ui.activeTab.shell.mainView = "chat";
  },
);
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

// ── Tab lifecycle — store mutations, boot/route reconcile, and per-tab route
// restoration all live in the composable (one home). ──
const { selectTab, closeTab, addTab, retargetTab } = useScopeTabs(
  allWorkspaces,
  () => workspacesQuery.isSuccess.value,
);

// ── Navigation handlers (write shared ui-store + route; the views react). ──
function selectSurface(id: string) {
  if (id === "home") {
    // Home is a global place — it lives on the pinned Global tab.
    ui.activateTab(GLOBAL_TAB_ID);
    void router.push({ name: "home" });
  } else if (id === "sessions") {
    openSessions();
  } else if (inWorkspaceScope.value) {
    // Chat follows the scope: a workspace room's Chat is ITS continuing
    // conversation — never a silent jump to the global thread (Chad,
    // 2026-07-21 live feedback).
    ui.activeTab.shell.mainView = "chat";
    void router.push({ name: "workspace" });
  } else {
    ui.activeTab.shell.mainView = "chat";
    void router.push({ name: "chat" });
  }
}

// The library follows the tab: a workspace room's Sessions lists that room's
// sessions (its primary chain + its spawned children); the Global tab lists
// everything.
function openSessions() {
  const workspaceId = ui.activeTab.workspaceId;
  void router.push({
    name: "sessions",
    ...(workspaceId !== null ? { query: { workspace: workspaceId } } : {}),
  });
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
  if (
    inWorkspaceScope.value &&
    (WORKSPACE_SECTION_IDS.has(id) || id === "customize")
  ) {
    ui.activeTab.shell.mainView = id as typeof ui.activeTab.shell.mainView;
    if (route.name !== "workspace") void router.push({ name: "workspace" });
  } else {
    // Global-only views (account, application, the global sections) always
    // render on the pinned Global tab.
    ui.activateTab(GLOBAL_TAB_ID);
    ui.globalTab.shell.mainView = id as typeof ui.globalTab.shell.mainView;
    if (route.name !== "chat") void router.push({ name: "chat" });
  }
}
function openAccount() {
  selectSection("account");
}

const isSidebarOpen = ref(true);
const isPaletteOpen = ref(false);
const isCreateWorkspaceOpen = ref(false);

// A note parked while no composer was on screen must not materialize in some
// future, wrong-scope draft — closing the browser view discards unconsumed
// seeds (covers the panel's own close button too).
watch(
  () => browser.isOpen,
  (open) => {
    if (!open) ui.composerSeed = null;
  },
);

// The native page webview draws above ALL HTML — whenever a shell overlay is
// up, the page yields so the overlay is actually visible. Every Modal-based
// dialog (ask wizard, plan review, create-workspace, task dialogs…) reports
// through the shared registry; the non-Modal overlays (palette, voice,
// monitor, the menu bar's dropdowns) are wired explicitly. Toasts don't hide
// the page; they dock left instead.
const conversationSidebar = useConversationSidebarStore();
const openModalCount = useOpenModalCount();
const areTitleBarMenusOpen = ref(false);
watch(
  () =>
    isPaletteOpen.value ||
    ui.isVoiceOverlayOpen ||
    conversationSidebar.isOpen ||
    openModalCount.value > 0 ||
    areTitleBarMenusOpen.value,
  (overlayUp) => {
    browser.isObscured = overlayUp;
  },
  { immediate: true },
);

function onWorkspaceCreated(workspace: WorkspaceResponse) {
  isCreateWorkspaceOpen.value = false;
  addTab(workspace.id);
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
      // Hidden by browser mode anyway — flipping the state invisibly would
      // surprise on restore.
      if (!browser.isOpen) isSidebarOpen.value = !isSidebarOpen.value;
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
    case "new-chat":
      ui.activateTab(GLOBAL_TAB_ID);
      ui.globalTab.shell.target = "fresh";
      ui.globalTab.shell.mainView = "chat";
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
      if (GLOBAL_MENU_ITEMS.some((item) => item.id === id)) selectSection(id);
  }
}

const paletteCommands = computed<CommandItem[]>(() => [
  { id: "new-chat", label: "New chat", group: "Assistant", shortcut: shortcutHint("N") },
  { id: "new-workspace", label: "New workspace", group: "Assistant" },
  { id: "start-voice", label: "Start voice", group: "Assistant" },
  { id: "go-home", label: "Go to Home", group: "Go" },
  { id: "go-chat", label: "Go to Chat", group: "Go" },
  { id: "go-sessions", label: "Go to Sessions", group: "Go" },
  ...workspaceOptions.value.map((w) => ({
    id: `ws:${w.id}`,
    label: w.name,
    hint: "Workspace",
    group: "Go",
  })),
  ...GLOBAL_MENU_ITEMS.map((item) =>
    item.icon
      ? { id: item.id, label: item.label, group: "Open", icon: item.icon }
      : { id: item.id, label: item.label, group: "Open" },
  ),
  { id: "toggle-theme", label: "Toggle theme", group: "View", keywords: "dark light" },
  { id: "toggle-sidebar", label: "Toggle navigation", group: "View" },
  { id: "toggle-tasks", label: "Toggle tasks", group: "View" },
]);

function onPaletteSelect(id: string) {
  if (id.startsWith("ws:")) {
    ui.openWorkspaceTab(id.slice(3));
    void router.push({ name: "workspace" });
  } else {
    runCommand(id);
  }
}

// The bound shortcuts. Every hint the menus advertise (K, N/⇧N, comma, Q)
// is a real binding — an advertised keystroke that does nothing reads as
// "the app is broken".
function onGlobalKeydown(event: KeyboardEvent) {
  if (!(event.metaKey || event.ctrlKey)) return;
  const key = event.key.toLowerCase();
  if (key === "k") {
    event.preventDefault();
    isPaletteOpen.value = true;
  } else if (key === "n") {
    event.preventDefault();
    runCommand(event.shiftKey ? "new-workspace" : "new-chat");
  } else if (key === ",") {
    event.preventDefault();
    runCommand("settings");
  } else if (key === "q") {
    event.preventDefault();
    windowControls.close();
  }
}
onMounted(() => window.addEventListener("keydown", onGlobalKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onGlobalKeydown));
</script>

<template>
  <!-- Browser mode is a focus TAKEOVER: the scope strip and sidebar tuck
       away (their grid row collapses), chat keeps the left, the page takes
       the right. Closing restores every piece — nothing is torn down. -->
  <div
    class="app-shell"
    :style="{
      gridTemplateRows: browser.isOpen ? '40px 1fr 22px' : '40px 40px 1fr 22px',
    }"
  >
    <AppTitleBar
      :title="contextTitle"
      :presence-state="presenceState"
      :presence-label="presenceLabel"
      :theme="ui.theme"
      :sidebar-open="isSidebarOpen"
      :tasks-open="ui.isTasksPanelOpen"
      :open-task-count="openTaskCount"
      @command="runCommand"
      @menus-open="areTitleBarMenusOpen = $event"
    />

    <AppTabStrip
      v-if="!browser.isOpen"
      :tabs="ui.tabs"
      :active-tab-id="ui.activeTabId"
      :workspaces="workspaceOptions"
      :workspace-color-slots="workspaceColorSlots"
      @select-tab="selectTab"
      @close-tab="closeTab"
      @retarget-tab="retargetTab"
      @color-tab="ui.setTabColor"
      @add-tab="addTab"
      @create-workspace="isCreateWorkspaceOpen = true"
    />

    <div class="app-body">
      <ResizablePanel
        v-if="isSidebarOpen && !browser.isOpen"
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
        <!-- Keyed per tab: each tab is its own view instance, so a view can
             safely bind to its tab's shell for its whole lifetime. -->
        <RouterView :key="ui.activeTabId" />
      </main>

      <ResizablePanel
        v-if="browser.isOpen"
        side="right"
        storage-key="vynel.browser.width"
        :default-width="640"
        :min-width="380"
        :max-width="1100"
      >
        <BrowserPanel />
      </ResizablePanel>
    </div>

    <AppStatusBar
      :presence-state="presenceState"
      :context-label="statusContext"
      :pending-approvals="pendingCount"
      @open-approvals="selectSurface('chat')"
    />

    <WorkingRail />
    <ConversationSidebar />
    <ApprovalNotifier />
    <AskNotifier />
    <VoiceOverlay />
    <!-- The SHARED plan review dialog — chat vynel://plan links, list View
         actions, and task plan chips all open this one instance. -->
    <PlanViewDialog />
    <ReportViewDialog />
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
  /* Rows come from the template binding — browser mode collapses the strip. */
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
