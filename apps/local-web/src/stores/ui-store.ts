import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { WORKSPACE_ACCENT_SLOTS } from "@vynel/ui";
import { DEFAULT_SESSION_MODE, SESSION_MODES } from "@vynel/session";
import type { SessionMode } from "@vynel/session";
import { CHAT_MODEL_ID_PATTERN, DEFAULT_CHAT_MODEL } from "@vynel/contracts/chat/chat-models";
import {
  DEFAULT_THINKING_EFFORT,
  THINKING_EFFORT_OPTIONS,
} from "@vynel/contracts/chat/thinking-effort";
import type { ThinkingEffortOption } from "@vynel/contracts/chat/thinking-effort";
import type { WorkspaceSectionId } from "../components/workspace/workspace-sections.js";

export type Theme = "dark" | "light";

/** How workspaces are navigated: the browser-style tab strip, or the sidebar
 *  workspace tree (the strip row collapses). One selection state under both —
 *  the mode only changes presentation. */
export type NavMode = "tabs" | "menu";

/** The Nodes screen's three readings of the same projects: the constellation,
 *  the same fleet as cards, and everything on one track toward done. */
export type NodesMode = "nodes" | "grid" | "race";

/** What the chat surface is pointed at: the ongoing single conversation (the
 *  default — Vynel's "one brain"), a fresh topic, or one history session. */
export type ChatTarget = "continuous" | "fresh" | { sessionId: string };

/** What the canvas shows: the chat itself, a menu item's view (Application and
 *  Account globally; a feature section in a workspace), or an open file. The
 *  session library is a ROUTED surface (`/sessions`), not a canvas view. */
export type ChatMainView =
  | "chat"
  // The spoken thread's window (voice-session arc) — global-only, sits right
  // under Chat in the menu.
  | "voice-chat"
  | "application"
  | "account"
  // Machine-level, global-only (like account/application): WHERE the engine
  // runs is a property of this computer, never of a workspace.
  | "engine"
  // Machine-level, global-only: which desktop apps Claude may see/control
  // (the per-app access grants) is a property of this computer.
  // Workspace-only: the Customize canvas (persona, color, menu layout). Not a
  // catalog section — it edits the catalog's rendering, so it can never be
  // hidden by it.
  | "customize"
  | WorkspaceSectionId
  | { kind: "file"; filePath: string };

/** What the composer's Thinking chip can hold — the picker catalog's ids. */
export type ComposerThinkingEffort = ThinkingEffortOption["id"];

export interface ChatShellState {
  mainView: ChatMainView;
  target: ChatTarget;
}

/** One scope tab on the strip: the pinned Global tab (`workspaceId: null`,
 *  always first) or a workspace room. Each tab carries its own canvas state,
 *  so switching tabs is real multitasking — nothing is torn down. */
export interface ShellTab {
  id: string;
  workspaceId: string | null;
  /** User-picked accent (a `--ws-*` slot, 1..N); null = auto (name hash).
   *  A TAB's color, deliberately — it survives retargeting the tab. */
  colorSlot: number | null;
  shell: ChatShellState;
  /** Where the tab last was, restored on re-activation. Runtime only. */
  lastRoutePath: string | null;
}

export const GLOBAL_TAB_ID = "global";

const THEME_STORAGE_KEY = "vynel.theme";
const TABS_STORAGE_KEY = "vynel.tabs";
const NAV_MODE_STORAGE_KEY = "vynel.nav-mode";
const LEGACY_WORKSPACE_STORAGE_KEY = "vynel.active-workspace";
const COMPOSER_MODE_STORAGE_KEY = "vynel.composer-mode";
const COMPOSER_MODEL_STORAGE_KEY = "vynel.composer-model";
const COMPOSER_THINKING_EFFORT_STORAGE_KEY = "vynel.composer-thinking-effort";
const COMPOSER_AUTO_BUILDOUT_STORAGE_KEY = "vynel.composer-auto-buildout";

function readStoredTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" ? "light" : "dark";
}

// Tabs is the default — it's the shell's long-standing behavior; menu is the
// opt-in view. Junk storage falls back to tabs like every stored value.
function readStoredNavMode(): NavMode {
  return localStorage.getItem(NAV_MODE_STORAGE_KEY) === "menu" ? "menu" : "tabs";
}

// Fail-closed restores: an unknown stored value (a renamed mode, a retired
// model id) falls back to the default instead of poisoning the composer.
function readStoredComposerMode(): SessionMode {
  const stored = localStorage.getItem(COMPOSER_MODE_STORAGE_KEY);
  return SESSION_MODES.some((mode) => mode.mode === stored)
    ? (stored as SessionMode)
    : DEFAULT_SESSION_MODE;
}

function readStoredComposerModel(): string {
  const stored = localStorage.getItem(COMPOSER_MODEL_STORAGE_KEY);
  // Shape-checked, not allowlist-checked: the roster is DISCOVERED now, so a
  // valid pick (e.g. a newly shipped model) may not be in the static floor.
  // Junk still fails closed to the default.
  return stored !== null && CHAT_MODEL_ID_PATTERN.test(stored)
    ? stored
    : DEFAULT_CHAT_MODEL;
}

function readStoredThinkingEffort(): ComposerThinkingEffort {
  const stored = localStorage.getItem(COMPOSER_THINKING_EFFORT_STORAGE_KEY);
  return THINKING_EFFORT_OPTIONS.some((option) => option.id === stored)
    ? (stored as ComposerThinkingEffort)
    : DEFAULT_THINKING_EFFORT;
}

// Auto buildout — the canvas's composer toggle, and since the session-hardening
// arc it means AUTOPILOT (Kafi's D8): the turn is told the user is probably not
// available, to continue by itself and make the best-fit call, researching with
// spawned agents when a decision needs grounding, and to set `needs_input` if
// it gets stuck. Resolved like the other settings and inherited by children.
// Off by default — a build that runs itself is opt-in.
function readStoredAutoBuildout(): boolean {
  return localStorage.getItem(COMPOSER_AUTO_BUILDOUT_STORAGE_KEY) === "on";
}

function freshShell(): ChatShellState {
  return { mainView: "chat", target: "continuous" };
}

function makeGlobalTab(): ShellTab {
  return {
    id: GLOBAL_TAB_ID,
    workspaceId: null,
    colorSlot: null,
    shell: freshShell(),
    lastRoutePath: null,
  };
}

function makeWorkspaceTab(workspaceId: string): ShellTab {
  return {
    id: crypto.randomUUID(),
    workspaceId,
    colorSlot: null,
    shell: freshShell(),
    lastRoutePath: null,
  };
}

// Fail-closed like every stored value: junk becomes auto, never a broken var().
function sanitizeColorSlot(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= WORKSPACE_ACCENT_SLOTS
    ? value
    : null;
}

// Fail-closed restore: junk storage seeds the default single Global tab
// instead of poisoning the strip. The pre-tabs active-workspace key migrates
// into one workspace tab, then retires.
function readStoredTabs(): { tabs: ShellTab[]; activeTabId: string } {
  const raw = localStorage.getItem(TABS_STORAGE_KEY);
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as {
        tabs?: { id?: unknown; workspaceId?: unknown; colorSlot?: unknown }[];
        activeTabId?: unknown;
      };
      const workspaceTabs = (parsed.tabs ?? [])
        .filter(
          (tab): tab is { id: string; workspaceId: string; colorSlot?: unknown } =>
            typeof tab.id === "string" &&
            tab.id !== GLOBAL_TAB_ID &&
            typeof tab.workspaceId === "string",
        )
        .map((tab) => ({
          id: tab.id,
          workspaceId: tab.workspaceId,
          colorSlot: sanitizeColorSlot(tab.colorSlot),
          shell: freshShell(),
          lastRoutePath: null,
        }));
      const tabs = [makeGlobalTab(), ...workspaceTabs];
      const activeTabId = tabs.some((tab) => tab.id === parsed.activeTabId)
        ? (parsed.activeTabId as string)
        : GLOBAL_TAB_ID;
      return { tabs, activeTabId };
    } catch {
      return { tabs: [makeGlobalTab()], activeTabId: GLOBAL_TAB_ID };
    }
  }
  const legacyWorkspaceId = localStorage.getItem(LEGACY_WORKSPACE_STORAGE_KEY);
  localStorage.removeItem(LEGACY_WORKSPACE_STORAGE_KEY);
  if (legacyWorkspaceId !== null) {
    const migrated = makeWorkspaceTab(legacyWorkspaceId);
    return { tabs: [makeGlobalTab(), migrated], activeTabId: migrated.id };
  }
  return { tabs: [makeGlobalTab()], activeTabId: GLOBAL_TAB_ID };
}

// Shell UI state only (server state lives in vue-query). One home for how the
// window presents itself: theme, the scope tabs and their canvas state, the
// tasks dock, the voice overlay.
export const useUiStore = defineStore("ui", () => {
  const theme = ref<Theme>(readStoredTheme());

  // Sync flush: the document attribute must change atomically with the state —
  // no wrong-theme frame between a toggle and the repaint.
  watch(
    theme,
    (value) => {
      document.documentElement.dataset.theme = value;
      localStorage.setItem(THEME_STORAGE_KEY, value);
    },
    { immediate: true, flush: "sync" },
  );

  function toggleTheme() {
    theme.value = theme.value === "dark" ? "light" : "dark";
  }

  // Navigation mode — persisted like the theme; the tab state underneath is
  // shared, so flipping modes never loses a scope or its canvas.
  const navMode = ref<NavMode>(readStoredNavMode());
  watch(navMode, (value) => localStorage.setItem(NAV_MODE_STORAGE_KEY, value));

  // Menu mode's sidebar shows the workspace tree (root) or the active scope's
  // section menu (drilled). Ephemeral by design: entering menu mode always
  // lands on the tree — that's the mode's whole point.
  const isWorkspaceTreeOpen = ref(true);

  function setNavMode(mode: NavMode) {
    if (mode === navMode.value) return;
    navMode.value = mode;
    if (mode === "menu") isWorkspaceTreeOpen.value = true;
  }

  // The scope tabs — the pinned Global tab plus any open workspace rooms.
  // The set (ids + targets) survives reloads so the user returns to the same
  // strip; canvas state within a tab starts fresh, like it always has.
  const restoredTabs = readStoredTabs();
  const tabs = ref<ShellTab[]>(restoredTabs.tabs);
  const activeTabId = ref<string>(restoredTabs.activeTabId);

  const globalTab = computed(() => tabs.value[0]!);
  const activeTab = computed(
    () => tabs.value.find((tab) => tab.id === activeTabId.value) ?? globalTab.value,
  );
  const activeWorkspaceId = computed(() => activeTab.value.workspaceId);

  const persistedTabs = computed(() =>
    JSON.stringify({
      tabs: tabs.value.map((tab) => ({
        id: tab.id,
        workspaceId: tab.workspaceId,
        colorSlot: tab.colorSlot,
      })),
      activeTabId: activeTabId.value,
    }),
  );
  // Immediate: the restored strip writes through right away, so a legacy-key
  // migration (which deletes the old key at read time) survives a reload that
  // happens before any structural change.
  watch(
    persistedTabs,
    (value) => localStorage.setItem(TABS_STORAGE_KEY, value),
    { immediate: true },
  );

  function activateTab(tabId: string) {
    if (tabs.value.some((tab) => tab.id === tabId)) activeTabId.value = tabId;
  }

  // Duplicate tabs for one room are allowed on purpose (browser semantics) —
  // e.g. the room's chat in one tab and its knowledge section in another.
  function addWorkspaceTab(workspaceId: string): ShellTab {
    const tab = makeWorkspaceTab(workspaceId);
    tabs.value.push(tab);
    activeTabId.value = tab.id;
    return tab;
  }

  // The Global tab is the anchor — it never closes. Closing the active tab
  // hands focus to its right neighbor (the browser convention), else left.
  function closeTab(tabId: string) {
    const index = tabs.value.findIndex((tab) => tab.id === tabId);
    if (index <= 0) return;
    tabs.value.splice(index, 1);
    if (activeTabId.value === tabId)
      activeTabId.value = (tabs.value[index] ?? tabs.value[index - 1]!).id;
  }

  // Point an existing tab at another room. The tab lands on that room's
  // continuous chat — a section carried over from the previous room would
  // render against the wrong workspace.
  function retargetTab(tabId: string, workspaceId: string) {
    const tab = tabs.value.find((row) => row.id === tabId);
    if (tab === undefined || tab.id === GLOBAL_TAB_ID) return;
    // Re-picking the tab's own room is a no-op — it must not wipe the tab's
    // place or yank an open section back to chat.
    if (tab.workspaceId === workspaceId) return;
    tab.workspaceId = workspaceId;
    tab.shell.mainView = "chat";
    tab.shell.target = "continuous";
    tab.lastRoutePath = null;
  }

  // Paint a tab: a `--ws-*` slot, or null to return to the name-derived auto
  // accent. The Global tab stays neutral — its mark is the identity anchor.
  function setTabColor(tabId: string, colorSlot: number | null) {
    const tab = tabs.value.find((row) => row.id === tabId);
    if (tab === undefined || tab.id === GLOBAL_TAB_ID) return;
    tab.colorSlot = sanitizeColorSlot(colorSlot);
  }

  // "Open workspace X" from anywhere (Home cards, the hero deck, a session
  // row): focus its existing tab or open one — landing on the room's chat.
  // The tab's conversation TARGET is kept: resetting it to "continuous" here
  // made switching away and back lose a fresh-session conversation from view
  // (its rows live on a session the continuous thread doesn't display — the
  // 2026-07-30 smoke). Cross-room resets stay in retargetTab, where the old
  // target really is invalid.
  function openWorkspaceTab(workspaceId: string): ShellTab {
    const existing = tabs.value.find((tab) => tab.workspaceId === workspaceId);
    if (existing === undefined) return addWorkspaceTab(workspaceId);
    existing.shell.mainView = "chat";
    existing.lastRoutePath = null;
    activeTabId.value = existing.id;
    return existing;
  }

  // A deleted workspace takes its tabs with it — a stale id would 404 every
  // scoped request. Reconciled by the shell once the workspace list loads.
  function pruneWorkspaceTabs(existingWorkspaceIds: string[]) {
    const keep = new Set(existingWorkspaceIds);
    const surviving = tabs.value.filter(
      (tab) => tab.workspaceId === null || keep.has(tab.workspaceId),
    );
    if (surviving.length === tabs.value.length) return;
    const activeSurvives = surviving.some((tab) => tab.id === activeTabId.value);
    tabs.value = surviving;
    if (!activeSurvives) activeTabId.value = GLOBAL_TAB_ID;
  }

  // The task rail opens by DEFAULT (task-execution arc, Kafi 2026-08-18):
  // tasks are the workspace's work queue now, so the plan is part of the
  // room's face — the toggle still closes it for the session.
  const isTasksPanelOpen = ref(true);

  // The plan being viewed in the SHARED PlanViewDialog (AppShell mounts it once)
  // — set from a chat `vynel://plan/<id>` link, a list row's View action, or a
  // task's plan chip; null = closed. One home so every surface opens the same
  // review dialog.
  const viewingPlanId = ref<string | null>(null);


  // Composer NEW-CHAT DEFAULTS (2026-08-17): once a session exists its
  // settings live on ITS row (use-session-settings → sessions.updateSettings),
  // so these refs only seed a composer with no session yet — and the first
  // turn's server write-through stamps them onto the row it creates.
  // PERSISTED: a chosen default silently reverting to 'ask' on reload read as
  // "modes don't work" — the selection must survive like the theme does.
  const composerModelId = ref<string>(readStoredComposerModel());
  const composerMode = ref<SessionMode>(readStoredComposerMode());
  const composerThinkingEffort = ref<ComposerThinkingEffort>(
    readStoredThinkingEffort(),
  );
  const composerAutoBuildout = ref<boolean>(readStoredAutoBuildout());

  watch(composerAutoBuildout, (value) =>
    localStorage.setItem(COMPOSER_AUTO_BUILDOUT_STORAGE_KEY, value ? "on" : "off"),
  );
  watch(composerMode, (value) =>
    localStorage.setItem(COMPOSER_MODE_STORAGE_KEY, value),
  );
  watch(composerModelId, (value) =>
    localStorage.setItem(COMPOSER_MODEL_STORAGE_KEY, value),
  );
  watch(composerThinkingEffort, (value) =>
    localStorage.setItem(COMPOSER_THINKING_EFFORT_STORAGE_KEY, value),
  );

  // A one-shot seed for the chat composer — another surface (the browser
  // view's "Ask Claude" note) drops text here; the composer consumes and
  // clears it, so the user reviews before sending.
  const composerSeed = ref<string | null>(null);

  // The Jarvis voice overlay — opens on the daemon's wake event or the mic button.
  const isVoiceOverlayOpen = ref(false);

  // A ring-the-bell counter for the create-workspace dialog. The dialog is
  // mounted once in AppShell; routed views (the Nodes screen's empty state)
  // can't reach its local ref, so they bump this and the shell watches it.
  const createWorkspaceRequestCount = ref(0);
  function requestCreateWorkspace() {
    createWorkspaceRequestCount.value += 1;
  }

  // Which reading the Nodes screen is on — the constellation, the same fleet
  // as cards, or the race toward done. Held here rather than in the view so it
  // survives leaving the route; not persisted, so a fresh app opens on the
  // constellation.
  const nodesMode = ref<NodesMode>("nodes");

  return {
    theme,
    toggleTheme,
    navMode,
    setNavMode,
    isWorkspaceTreeOpen,
    tabs,
    activeTabId,
    activeTab,
    globalTab,
    activeWorkspaceId,
    activateTab,
    addWorkspaceTab,
    closeTab,
    retargetTab,
    setTabColor,
    openWorkspaceTab,
    pruneWorkspaceTabs,
    isTasksPanelOpen,
    viewingPlanId,
    composerModelId,
    composerMode,
    composerThinkingEffort,
    composerAutoBuildout,
    composerSeed,
    isVoiceOverlayOpen,
    createWorkspaceRequestCount,
    requestCreateWorkspace,
    nodesMode,
  };
});
