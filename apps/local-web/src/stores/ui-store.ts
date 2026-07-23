import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { DEFAULT_SESSION_MODE, SESSION_MODES } from "@vynel/session";
import type { SessionMode } from "@vynel/session";
import { CHAT_MODELS, DEFAULT_CHAT_MODEL } from "@vynel/contracts/chat/chat-models";
import {
  DEFAULT_THINKING_EFFORT,
  THINKING_EFFORT_OPTIONS,
} from "@vynel/contracts/chat/thinking-effort";
import type { ThinkingEffortOption } from "@vynel/contracts/chat/thinking-effort";
import type { WorkspaceSectionId } from "../components/workspace/workspace-sections.js";

export type Theme = "dark" | "light";

/** What the chat surface is pointed at: the ongoing single conversation (the
 *  default — Vynel's "one brain"), a fresh topic, or one history session. */
export type ChatTarget = "continuous" | "fresh" | { sessionId: string };

/** What the canvas shows: the chat itself, a menu item's view (Application and
 *  Account globally; a feature section in a workspace), or an open file. The
 *  session library is a ROUTED surface (`/sessions`), not a canvas view. */
export type ChatMainView =
  | "chat"
  | "application"
  | "account"
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
  shell: ChatShellState;
  /** Where the tab last was, restored on re-activation. Runtime only. */
  lastRoutePath: string | null;
}

export const GLOBAL_TAB_ID = "global";

const THEME_STORAGE_KEY = "vynel.theme";
const TABS_STORAGE_KEY = "vynel.tabs";
const LEGACY_WORKSPACE_STORAGE_KEY = "vynel.active-workspace";
const COMPOSER_MODE_STORAGE_KEY = "vynel.composer-mode";
const COMPOSER_MODEL_STORAGE_KEY = "vynel.composer-model";
const COMPOSER_THINKING_EFFORT_STORAGE_KEY = "vynel.composer-thinking-effort";

function readStoredTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" ? "light" : "dark";
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
  return CHAT_MODELS.some((model) => model.id === stored)
    ? (stored as string)
    : DEFAULT_CHAT_MODEL;
}

function readStoredThinkingEffort(): ComposerThinkingEffort {
  const stored = localStorage.getItem(COMPOSER_THINKING_EFFORT_STORAGE_KEY);
  return THINKING_EFFORT_OPTIONS.some((option) => option.id === stored)
    ? (stored as ComposerThinkingEffort)
    : DEFAULT_THINKING_EFFORT;
}

function freshShell(): ChatShellState {
  return { mainView: "chat", target: "continuous" };
}

function makeGlobalTab(): ShellTab {
  return {
    id: GLOBAL_TAB_ID,
    workspaceId: null,
    shell: freshShell(),
    lastRoutePath: null,
  };
}

function makeWorkspaceTab(workspaceId: string): ShellTab {
  return {
    id: crypto.randomUUID(),
    workspaceId,
    shell: freshShell(),
    lastRoutePath: null,
  };
}

// Fail-closed restore: junk storage seeds the default single Global tab
// instead of poisoning the strip. The pre-tabs active-workspace key migrates
// into one workspace tab, then retires.
function readStoredTabs(): { tabs: ShellTab[]; activeTabId: string } {
  const raw = localStorage.getItem(TABS_STORAGE_KEY);
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as {
        tabs?: { id?: unknown; workspaceId?: unknown }[];
        activeTabId?: unknown;
      };
      const workspaceTabs = (parsed.tabs ?? [])
        .filter(
          (tab): tab is { id: string; workspaceId: string } =>
            typeof tab.id === "string" &&
            tab.id !== GLOBAL_TAB_ID &&
            typeof tab.workspaceId === "string",
        )
        .map((tab) => ({
          id: tab.id,
          workspaceId: tab.workspaceId,
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

  // "Open workspace X" from anywhere (Home cards, the hero deck, a session
  // row): focus its existing tab or open one — landing on the room's chat.
  function openWorkspaceTab(workspaceId: string): ShellTab {
    const existing = tabs.value.find((tab) => tab.workspaceId === workspaceId);
    if (existing === undefined) return addWorkspaceTab(workspaceId);
    existing.shell.mainView = "chat";
    existing.shell.target = "continuous";
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

  // The tasks dock is opt-in, off by default — chat stays the whole story
  // until the user asks for the list.
  const isTasksPanelOpen = ref(false);

  // The plan being viewed in the SHARED PlanViewDialog (AppShell mounts it once)
  // — set from a chat `vynel://plan/<id>` link, a list row's View action, or a
  // task's plan chip; null = closed. One home so every surface opens the same
  // review dialog.
  const viewingPlanId = ref<string | null>(null);

  // Composer selections, shared by every chat surface — both the model
  // allowlist and the mode vocabulary are the real contract/session ones.
  // PERSISTED: a chosen mode silently reverting to 'ask' on reload read as
  // "modes don't work" — the selection must survive like the theme does.
  const composerModelId = ref<string>(readStoredComposerModel());
  const composerMode = ref<SessionMode>(readStoredComposerMode());
  const composerThinkingEffort = ref<ComposerThinkingEffort>(
    readStoredThinkingEffort(),
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

  // The Jarvis voice overlay — opens on the daemon's wake event or the mic button.
  const isVoiceOverlayOpen = ref(false);

  return {
    theme,
    toggleTheme,
    tabs,
    activeTabId,
    activeTab,
    globalTab,
    activeWorkspaceId,
    activateTab,
    addWorkspaceTab,
    closeTab,
    retargetTab,
    openWorkspaceTab,
    pruneWorkspaceTabs,
    isTasksPanelOpen,
    viewingPlanId,
    composerModelId,
    composerMode,
    composerThinkingEffort,
    isVoiceOverlayOpen,
  };
});
