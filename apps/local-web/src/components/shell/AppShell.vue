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
  PhGraph as Graph,
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
  PhSpeakerHigh as SpeakerHigh,
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
import { workspaceAccentCss } from "../../utils/workspace-accent.js";
import { useVynel } from "../../composables/use-vynel.js";
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
import { useVoiceChatStatus } from "../../composables/sessions/use-voice-chat-status.js";
import { useDisplayToggle } from "../../composables/display/use-display-toggle.js";
import { useDisplayVoice } from "../../composables/display/use-display-voice.js";
import { useViewMode } from "../../composables/shell/use-view-mode.js";
import { foldGlobalAreaStatus } from "./global-area-status.js";
import type { WorkspaceResponse } from "@vynel/contracts/workspaces/workspace-http";

// The reinvented desktop shell — mounted only for real surfaces (App.vue keeps
// bare routes and the onboarding wizard out of here, so the /display-dock window
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
  activeWorkspaces.value.map((w) => {
    const custom = customize.customizationFor(w.id);
    return {
      id: w.id,
      name: w.name,
      groupId: w.groupId ?? null,
      imageUrl: custom.workspaceImage,
      accent: workspaceAccentCss(custom, w.name),
    };
  }),
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
// The machine-level screens — this computer's, never a room's. They live in
// the title bar's Settings MENU (Kafi, 2026-08-22: Embedding · Voice · Where
// Vynel runs · Application), not the sidebar; they stay in the palette's
// Open group and route like any global section.
const GLOBAL_SETTINGS_ITEMS: SidebarItem[] = [
  { id: "embedding", label: "Embedding", icon: Graph },
  { id: "voice-settings", label: "Voice", icon: SpeakerHigh },
  { id: "engine", label: "Where Vynel runs", icon: Cpu },
  { id: "application", label: "Application", icon: Settings2 },
];
// The one system row left in the sidebar — Account is the person, not a
// setting. Pinned, never customizable.
const GLOBAL_SYSTEM_ITEMS: SidebarItem[] = [{ id: "account", label: "Account", icon: UserRound }];
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
const vynel = useVynel();
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
  ...GLOBAL_SETTINGS_ITEMS,
  ...GLOBAL_SYSTEM_ITEMS,
  CUSTOMIZE_ITEM,
];
// The menu's right-hand numbers (the canvas's per-row counts) — one request
// per scope, stamped onto whichever rows the engine can answer for.
const { countBySectionId } = useSectionCounts(
  computed(() => ui.activeTab.workspaceId),
);
// The spoken thread's own status (session-hardening D2). It reads its own
// door, not the shared overview — that answer is also `list_sessions`, and
// the voice conversation stays behind the cross-session wall.
const voiceChat = useVoiceChatStatus();
const voiceChatItem = computed<SidebarItem>(() => ({
  ...VOICE_CHAT_ITEM,
  status: voiceChat.status.value,
}));
const sectionItems = computed<SidebarItem[]>(() => {
  const workspaceId = ui.activeTab.workspaceId;
  const counts = countBySectionId.value;
  // By id, not position — a future SURFACE_ITEMS reorder must not silently
  // misplace or drop rows (reviewer nit).
  const surfaceItems =
    workspaceId === null
      ? SURFACE_ITEMS.flatMap((item) =>
          item.id === "chat" ? [item, voiceChatItem.value] : [item],
        )
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
// The shell's GLOBAL light covers the whole area: the assistant thread OR the
// spoken thread under it (D7). The Tasks panel keeps the plain `globalStatus`
// on purpose — that one is a per-scope task rollup, not the shell's light.
const globalAreaStatus = computed(() =>
  foldGlobalAreaStatus(globalStatus.value, voiceChat.status.value?.status ?? null),
);

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
    // The workspace's own face — the logo the tree shows, else its monogram.
    imageUrl: customize.customizationFor(workspaceId).workspaceImage,
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
  if (workspaceId === null) {
    if (ui.activeTab.workspaceId !== null) selectTab(GLOBAL_TAB_ID);
    return;
  }
  // A workspace row always opens that room's chat — even when the room is
  // already the active tab on some other section (Kafi, 2026-08-19).
  ui.openWorkspaceTab(workspaceId);
  void router.push({ name: "workspace" });
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
// The group a "+" was clicked on — the dialog's starting Group; null = root.
const createWorkspaceGroupId = ref<string | null>(null);
function openCreateWorkspace(groupId: string | null = null) {
  createWorkspaceGroupId.value = groupId;
  isCreateWorkspaceOpen.value = true;
}
// The strip's stack-plus: one create in flight at a time (a double-click must
// not mint two "New group" rows); the created row opens into its rename box.
const renameGroupId = ref<string | null>(null);
function createGroupFromTree() {
  if (groupMutations.createGroup.isPending.value) return;
  groupMutations.createGroup.mutate("New group", {
    onSuccess: (group) => {
      renameGroupId.value = group.id;
    },
  });
}
const isClaudeAccountOpen = ref(false);

// The dialog is mounted once, here. A routed view (the Nodes screen's empty
// state) can't reach that ref, so it rings the store's bell and we answer.
watch(
  () => ui.createWorkspaceRequestCount,
  () => {
    openCreateWorkspace();
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

// The Display switch — the real voice on/off — and `displayVoice.ownsVoice`,
// the ONE reading of "the Display feature holds this window's microphone".
// The title-bar glyph, the voice overlay's suppression and "Start voice" all
// take their answer from that one predicate, so they can never disagree.
// `showDisplay` is the wake path: it puts the room on screen without touching
// the session the wake just announced.
const { isDisplayActive, toggleDisplay, showDisplay, leaveDisplay, pickDisplay } =
  useDisplayToggle();
const displayVoice = useDisplayVoice();

// The view switch's reading (Kafi, 2026-08-22) — Nodes | Display | Normal,
// derived from the route + the Display toggle, and whether that view fills
// the window. In full view the chrome steps out: the title bar is its corner
// cluster, the sidebar and strip are gone, and the view's own top bar leaves
// the cluster room on the right (`--chrome-inset-right`, set below).
const { viewMode, isFullView } = useViewMode(isDisplayActive);

// "Normal" is wherever the canvas was before the view took it: the room hands
// the tab its previous view back, the Nodes screen returns to the global chat
// (it only ever lives on the Global tab). Through `selectSurface`, not a raw
// route push: a room still parked on the global tab would otherwise come
// straight back as the chat route lands (review, 2026-08-22).
function returnToNormalView() {
  if (viewMode.value === "display") leaveDisplay();
  else if (viewMode.value === "nodes") selectSurface("chat");
}

// The overlay's own switch must never outlive the overlay. It can be left ON
// behind the Display — "Start voice" from the palette, then a menu row into
// the room — and the overlay unmounts without ever seeing it change, which
// would leave the page dimmed below for a dialog that isn't there.
watch(
  () => displayVoice.ownsVoice,
  (owns) => {
    if (owns) ui.isVoiceOverlayOpen = false;
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
      openCreateWorkspace();
      break;
    case "claude-account":
      isClaudeAccountOpen.value = true;
      break;
    // Whoever owns the microphone answers. Once the Display has it — the room
    // on screen, or a session still running behind another view — raising the
    // overlay would start a second one and dim the page for an overlay that
    // isn't mounted.
    case "start-voice":
      if (displayVoice.ownsVoice) displayVoice.start();
      else ui.isVoiceOverlayOpen = true;
      break;
    // The Display owns its own session — never the overlay's (two live
    // sessions would mean two orbs and two microphones).
    case "toggle-display":
      toggleDisplay();
      break;
    // The view switch's segments. Display goes to the room and takes the
    // microphone if nobody has it (or closes the room when already there);
    // Normal restores the canvas. Nodes and the Display open full by
    // themselves — `isFullView` is derived, nothing to flip.
    case "view-display":
      pickDisplay();
      break;
    case "view-normal":
      returnToNormalView();
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
  {
    id: "toggle-display",
    label: "Display",
    group: "Assistant",
    keywords: "orb room voice console status",
  },
  { id: "go-home", label: "Go to Home", group: "Go" },
  { id: "go-chat", label: "Go to Chat", group: "Go" },
  { id: "go-sessions", label: "Go to Sessions", group: "Go" },
  { id: "open-nodes", label: "Go to Nodes", group: "Go", keywords: "fleet constellation projects" },
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

// Customization lives in the DB: pull it at boot and every time the window
// comes back (another window may have changed it — the server's rows win over
// anything not still unsaved here); push what's unsaved when the window goes.
// hydrate() never rejects — a boot with the engine down keeps the cache.
onMounted(() => {
  void customize.hydrate(vynel);
});
function syncCustomizeOnVisibility() {
  if (document.visibilityState === "hidden") void customize.flush();
  else void customize.hydrate(vynel);
}
function flushCustomizeOnPageHide() {
  void customize.flush();
}
onMounted(() => {
  document.addEventListener("visibilitychange", syncCustomizeOnVisibility);
  window.addEventListener("pagehide", flushCustomizeOnPageHide);
});
onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", syncCustomizeOnVisibility);
  window.removeEventListener("pagehide", flushCustomizeOnPageHide);
});
</script>

<template>
  <!-- Browser mode is a focus TAKEOVER: the scope strip and sidebar tuck
       away (their grid row collapses), chat keeps the left, the page takes
       the right. Closing restores every piece — nothing is torn down. -->
  <div class="app-shell" :class="{ 'full-view': isFullView }">
    <AppTitleBar
      :theme="ui.theme"
      :nav-mode="ui.navMode"
      :sidebar-open="isSidebarOpen"
      :tasks-open="ui.isTasksPanelOpen"
      :shows-tasks-toggle="!inWorkspaceScope"
      :display-on="displayVoice.ownsVoice"
      :view-mode="viewMode"
      :full-view="isFullView"
      @command="runCommand"
      @menus-open="areTitleBarMenusOpen = $event"
    />

    <div class="app-body">
      <!-- Full view takes the sidebar with the menus — the state underneath is
           untouched, so leaving full view brings it straight back. -->
      <ResizablePanel
        v-if="isSidebarOpen && !browser.isOpen && !isFullView"
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
          :global-status="globalAreaStatus"
          :account-name="accountName"
          :rename-group-id="renameGroupId"
          :tree-order="customize.treeLayout"
          @select="treeSelect"
          @drill="treeDrill"
          @create-workspace="openCreateWorkspace"
          @create-group="createGroupFromTree"
          @order-change="customize.setTreeLayout"
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
          v-if="!browser.isOpen && ui.navMode === 'tabs' && !isFullView"
          :tabs="ui.tabs"
          :active-tab-id="ui.activeTabId"
          :workspaces="workspaceOptions"
          :workspace-color-slots="workspaceColorSlots"
          :status-by-workspace-id="statusByWorkspaceId"
          :global-status="globalAreaStatus"
          @select-tab="selectTab"
          @close-tab="closeTab"
          @add-tab="addTab"
          @create-workspace="openCreateWorkspace()"
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
    <!-- Unmounted, not merely hidden, whenever the Display owns this window's
         voice — the room on screen OR a session still running behind another
         view. The overlay's session and wake link are created in ITS setup, so
         a merely-invisible one would still answer a wake with a second orb, a
         second microphone and a second player. -->
    <VoiceOverlay v-if="!displayVoice.ownsVoice" @show-display="showDisplay" />
    <UpdatePill />
    <!-- The SHARED plan review dialog — chat vynel://plan links, list View
         actions, and task plan chips all open this one instance. -->
    <PlanViewDialog />
    <CreateWorkspaceDialog
      :open="isCreateWorkspaceOpen"
      :default-group-id="createWorkspaceGroupId"
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
  position: relative;
  display: grid;
  /* Title bar · body — the canvas's rows (34px bar, no status bar; the
     strip lives inside the canvas column). */
  grid-template-rows: 34px 1fr;
  height: 100vh;
  background: var(--bg-shell);
  color: var(--ink-1);
}

/* Full view: the body takes the whole window and the title bar floats over
   its top-right corner as the cluster alone (it positions itself against
   this box). The inset is that cluster's width — the view's own top strip
   reads it to keep its right end clear. */
.app-shell.full-view {
  grid-template-rows: 1fr;
  --chrome-inset-right: 268px;
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
