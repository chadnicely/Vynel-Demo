<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  PhRobot as Bot,
  PhBookOpen as BookOpen,
  PhBrain as Brain,
  PhPlugsConnected as Cable,
  PhCalendarDots as CalendarClock,
  PhCalendarBlank as CalendarRange,
  PhCpu as Cpu,
  PhTreeView as FolderTree,
  PhClockCounterClockwise as History,
  PhHouse as House,
  PhListChecks as ListChecks,
  PhChatCircle as MessageCircle,
  PhMicrophone as Microphone,
  PhNotePencil as NotebookPen,
  PhBroadcast as Radio,
  PhScroll as ScrollText,
  PhHardDrives as Server,
  PhGearFine as Settings2,
  PhShieldCheck as ShieldCheck,
  PhSlidersHorizontal as SlidersHorizontal,
  PhPlayCircle as SquarePlay,
  PhTerminalWindow as SquareSlash,
  PhStorefront as Store,
  PhUser as UserRound,
  PhWrench as Wrench,
} from "@phosphor-icons/vue";
import {
  CommandPalette,
  ResizablePanel,
  useOpenModalCount,
  workspaceMonogram,
} from "@vynel/ui";
import type { CommandItem } from "@vynel/ui";
import AppTitleBar from "./AppTitleBar.vue";
import AppTabStrip from "./AppTabStrip.vue";
import AppSidebar from "./AppSidebar.vue";
import WorkspaceTree from "./WorkspaceTree.vue";
import BrowserPanel from "../browser/BrowserPanel.vue";
import type { SidebarItem } from "./AppSidebar.vue";
import ApprovalNotifier from "./ApprovalNotifier.vue";
import UpdatePill from "./UpdatePill.vue";
import AskNotifier from "../asks/AskNotifier.vue";
import VoiceOverlay from "../voice/VoiceOverlay.vue";
import ConversationSidebar from "../sidebar/ConversationSidebar.vue";
import WorkingRail from "../rail/WorkingRail.vue";
import CreateWorkspaceDialog from "../workspace/CreateWorkspaceDialog.vue";
import ClaudeAccountDialog from "../providers/ClaudeAccountDialog.vue";
import PlanViewDialog from "../plans/PlanViewDialog.vue";
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
import { useBrowserStore } from "../../stores/browser-store.js";
import { useConversationSidebarStore } from "../../stores/conversation-sidebar-store.js";
import { useWorkspaceList } from "../../composables/workspaces/use-workspace-list.js";
import {
  useWorkspaceGroups,
  useWorkspaceGroupMutations,
} from "../../composables/workspaces/use-workspace-groups.js";
import { useWorkspaceStatuses } from "../../composables/workspaces/use-workspace-status.js";
import { useSectionCounts } from "../../composables/workspaces/use-section-counts.js";
import { useCurrentUser } from "../../composables/users/use-current-user.js";
import { useSessionActivityFeed } from "../../composables/activity/use-session-activity-feed.js";
import type { WorkspaceResponse } from "@vynel/contracts/workspaces/workspace-http";

// The reinvented desktop shell — mounted only for real surfaces (App.vue keeps
// bare routes and the onboarding wizard out of here, so the /jarvis overlay
// never pays for the shell's data hooks). Navigation writes the shared ui-store
// + route; the routed view reacts.
const route = useRoute();
const router = useRouter();

const ui = useUiStore();
const browser = useBrowserStore();
// Ctrl/⌘+Q closes the window from anywhere — same controls the title bar drives.
const windowControls = useWindowControls();
// One capture-phase listener for in-app vynel:// links (plan links in
// assistant markdown, anywhere they render).
useAppLinkRouter();
const workspacesQuery = useWorkspaceList();
const currentUserQuery = useCurrentUser();
// The app's single activity subscription (on the window's live socket) — server-reported turns
// (Telegram, another tab, schedule fires) fold into the activity store so the
// chat views go live and the presence dot lights for background work.
useSessionActivityFeed();

const surface = computed<"home" | "chat" | "sessions" | "workspace" | "nodes">(
  () => {
    const name = route.name;
    return name === "home" ||
      name === "workspace" ||
      name === "sessions" ||
      name === "nodes"
      ? name
      : "chat";
  },
);
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
  activeWorkspaces.value.map((w) => ({
    id: w.id,
    name: w.name,
    groupId: w.groupId ?? null,
  })),
);

// Menu-tree folders (Arc 2b) — the tree renders them; the mutations answer
// its create/rename/delete/move events.
const workspaceGroupsQuery = useWorkspaceGroups();
const workspaceGroupOptions = computed(() =>
  (workspaceGroupsQuery.data.value ?? []).map((group) => ({
    id: group.id,
    name: group.name,
  })),
);
const groupMutations = useWorkspaceGroupMutations();
const activeWorkspaceName = computed(
  () =>
    allWorkspaces.value.find((w) => w.id === ui.activeWorkspaceId)?.name ??
    null,
);

const accountName = computed(
  () => currentUserQuery.data.value?.displayName ?? "Your account",
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
// The spoken thread's window (voice-session arc) — GLOBAL only (a workspace
// has no voice area), rendered right under Chat.
const VOICE_CHAT_ITEM: SidebarItem = { id: "voice-chat", label: "Voice chat", icon: Microphone };
const SECTION_ICONS: Record<string, SidebarItem["icon"]> = {
  agents: Bot,
  skills: Wrench,
  rules: ScrollText,
  commands: SquareSlash,
  "tool-policy": ShieldCheck,
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
// The menu's right-hand numbers (the canvas's per-row counts) — one request
// per scope, stamped onto whichever rows the engine can answer for.
const { countBySectionId } = useSectionCounts(
  computed(() => ui.activeTab.workspaceId),
);
const sectionItems = computed<SidebarItem[]>(() => {
  const workspaceId = ui.activeTab.workspaceId;
  const counts = countBySectionId.value;
  const surfaceItems =
    workspaceId === null
      ? [SURFACE_ITEMS[0]!, SURFACE_ITEMS[1]!, VOICE_CHAT_ITEM, SURFACE_ITEMS[2]!]
      : SURFACE_ITEMS;
  return [
    ...surfaceItems,
    ...customizedMenuItems(workspaceId ?? GLOBAL_SCOPE_KEY),
  ].map((item) => {
    const count = counts[item.id];
    return count === undefined ? item : { ...item, count };
  });
});

// Live per-scope status (one status one colour, Arc 5b) — the strip's
// chips/dots, the workspace tree, and the title-bar presence all read the
// same derivation.
const { statusByWorkspaceId, globalStatus } = useWorkspaceStatuses();

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

// The drilled sidebar's workspace header card (the canvas's app card):
// identity + a live status line worded per the vocabulary.
const sidebarWorkspaceCard = computed(() => {
  const workspaceId = ui.activeTab.workspaceId;
  if (workspaceId === null) return null;
  const name = activeWorkspaceName.value ?? "Workspace";
  const view = statusByWorkspaceId.value[workspaceId] ?? null;
  const status = view?.status ?? "not_running";
  const counts =
    view !== null && view.tasksTotal > 0
      ? `Task ${Math.min(view.tasksDone + 1, view.tasksTotal)} of ${view.tasksTotal}`
      : null;
  const statusLine =
    status === "running"
      ? (counts !== null ? `${counts} · building now` : "Working now")
      : status === "needs_input"
        ? (counts !== null ? `${counts} — needs you` : "Waiting on your answer")
        : status === "problem"
          ? "Hit a problem — needs a look"
          : status === "completed"
            ? (view !== null && view.tasksTotal > 0
                ? `All ${view.tasksTotal} tasks done`
                : "All done")
            : "Nothing running";
  return {
    name,
    initials: workspaceMonogram(name),
    statusLine,
    statusTone: status,
  };
});
const activeSectionId = computed(() => {
  if (surface.value === "home") return "home";
  if (surface.value === "sessions") return "sessions";
  // The Nodes screen is reached from the title bar, not the sidebar menu — so
  // nothing there is active. Falling through would have marked Chat.
  if (surface.value === "nodes") return null;
  const view = scopeShell.value.mainView;
  if (typeof view !== "string") return null;
  if (view !== "chat") return view;
  // The thread itself: Chat follows the scope (a room's Chat is ITS continuing
  // conversation), so the global thread AND a workspace thread both mark it.
  return "chat";
});

// ── Tab lifecycle — store mutations, boot/route reconcile, and per-tab route
// restoration all live in the composable (one home). ──
const { selectTab, closeTab, addTab } = useScopeTabs(
  allWorkspaces,
  () => workspacesQuery.isSuccess.value,
);

// ── Menu-mode navigation: the tree is the root; selecting drives the SAME
// tab machinery the strip uses (selectTab restores the tab's place), so the
// two modes stay one state. ──
function treeSelect(workspaceId: string | null) {
  // Clicking the already-active row is inert — duplicate tabs are legal, so
  // "find first tab for this room" could otherwise hop a later duplicate's
  // canvas over to the first one's place.
  if (ui.activeTab.workspaceId === workspaceId) return;
  if (workspaceId === null) {
    selectTab(GLOBAL_TAB_ID);
    return;
  }
  const existing = ui.tabs.find((tab) => tab.workspaceId === workspaceId);
  if (existing !== undefined) selectTab(existing.id);
  else addTab(workspaceId);
}

function treeDrill(workspaceId: string | null) {
  treeSelect(workspaceId);
  ui.isWorkspaceTreeOpen = false;
}

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
const isClaudeAccountOpen = ref(false);

// The dialog is mounted once, here. A routed view (the Nodes screen's empty
// state) can't reach that ref, so it rings the store's bell and we answer.
watch(
  () => ui.createWorkspaceRequestCount,
  () => {
    isCreateWorkspaceOpen.value = true;
  },
);

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
    case "nav-tabs":
      ui.setNavMode("tabs");
      break;
    case "nav-menu":
      ui.setNavMode("menu");
      break;
    case "go-home":
      void router.push({ name: "home" });
      break;
    // The title bar's Nodes word — ALL the software's node screen (Chad,
    // 2026-08-11). It shows the whole fleet, so it leaves any workspace tab.
    case "open-nodes":
      ui.activateTab(GLOBAL_TAB_ID);
      void router.push({ name: "nodes" });
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
    case "claude-account":
      isClaudeAccountOpen.value = true;
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
  { id: "claude-account", label: "Claude account", group: "Open", keywords: "sign in login subscription usage" },
  { id: "toggle-theme", label: "Toggle theme", group: "View", keywords: "dark light" },
  { id: "toggle-sidebar", label: "Toggle navigation", group: "View" },
  { id: "toggle-tasks", label: "Toggle tasks", group: "View" },
  ui.navMode === "tabs"
    ? { id: "nav-menu", label: "Switch to menu navigation", group: "View", keywords: "tree workspaces" }
    : { id: "nav-tabs", label: "Switch to tabs navigation", group: "View", keywords: "strip" },
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
  <div class="app-shell">
    <AppTitleBar
      :theme="ui.theme"
      :nav-mode="ui.navMode"
      :sidebar-open="isSidebarOpen"
      :tasks-open="ui.isTasksPanelOpen"
      :shows-tasks-toggle="!inWorkspaceScope"
      @command="runCommand"
      @menus-open="areTitleBarMenusOpen = $event"
    />

    <div class="app-body">
      <ResizablePanel
        v-if="isSidebarOpen && !browser.isOpen"
        side="left"
        storage-key="vynel.sidebar.width"
        :default-width="208"
        :min-width="200"
        :max-width="380"
      >
        <WorkspaceTree
          v-if="ui.navMode === 'menu' && ui.isWorkspaceTreeOpen"
          :workspaces="workspaceOptions"
          :groups="workspaceGroupOptions"
          :active-workspace-id="ui.activeWorkspaceId"
          :status-by-workspace-id="statusByWorkspaceId"
          :global-status="globalStatus"
          :account-name="accountName"
          @select="treeSelect"
          @drill="treeDrill"
          @create-workspace="isCreateWorkspaceOpen = true"
          @create-group="groupMutations.createGroup.mutate('New folder')"
          @rename-group="(groupId, name) => groupMutations.renameGroup.mutate({ groupId, name })"
          @delete-group="(groupId) => groupMutations.deleteGroup.mutate(groupId)"
          @move-workspace="
            (workspaceId, groupId) =>
              groupMutations.moveWorkspace.mutate({ workspaceId, groupId })
          "
          @open-account="openAccount"
        />
        <AppSidebar
          v-else
          :section-title="sectionTitle"
          :section-items="sectionItems"
          :active-section-id="activeSectionId"
          :account-name="accountName"
          :show-back="ui.navMode === 'menu'"
          :workspace-card="sidebarWorkspaceCard"
          @select-section="selectSection"
          @open-account="openAccount"
          @back="ui.isWorkspaceTreeOpen = true"
        />
      </ResizablePanel>

      <div class="canvas-stack">
        <!-- The strip lives in the canvas column (the canvas's layout: tabs
             start at the chat edge, the sidebar runs beside them). Menu mode
             collapses it — the sidebar tree takes over. -->
        <AppTabStrip
          v-if="!browser.isOpen && ui.navMode === 'tabs'"
          :tabs="ui.tabs"
          :active-tab-id="ui.activeTabId"
          :workspaces="workspaceOptions"
          :workspace-color-slots="workspaceColorSlots"
          :status-by-workspace-id="statusByWorkspaceId"
          :global-status="globalStatus"
          @select-tab="selectTab"
          @close-tab="closeTab"
          @add-tab="addTab"
          @create-workspace="isCreateWorkspaceOpen = true"
        />
        <main class="canvas-wrap">
          <!-- Keyed per tab: each tab is its own view instance, so a view can
               safely bind to its tab's shell for its whole lifetime. -->
          <RouterView :key="ui.activeTabId" />
        </main>
      </div>

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

    <WorkingRail />
    <ConversationSidebar />
    <ApprovalNotifier />
    <AskNotifier />
    <VoiceOverlay />
    <UpdatePill />
    <!-- The SHARED plan review dialog — chat vynel://plan links, list View
         actions, and task plan chips all open this one instance. -->
    <PlanViewDialog />
    <CreateWorkspaceDialog
      :open="isCreateWorkspaceOpen"
      @close="isCreateWorkspaceOpen = false"
      @created="onWorkspaceCreated"
    />
    <ClaudeAccountDialog
      :open="isClaudeAccountOpen"
      @close="isClaudeAccountOpen = false"
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
  /* Title bar · body — the canvas's rows (34px bar, no status bar; the
     strip lives inside the canvas column). */
  grid-template-rows: 34px 1fr;
  height: 100vh;
  background: var(--bg-shell);
  color: var(--ink-1);
}

.app-body {
  display: flex;
  min-height: 0;
  overflow: hidden;
}

.canvas-stack {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.canvas-wrap {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
</style>
