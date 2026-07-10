import { reactive, ref, watch } from "vue";
import { defineStore } from "pinia";
import { DEFAULT_SESSION_MODE } from "@vynel/session";
import type { SessionMode } from "@vynel/session";
import { DEFAULT_CHAT_MODEL } from "@vynel/contracts/chat/chat-models";
import type { WorkspaceSectionId } from "../components/workspace/workspace-sections.js";

export type Theme = "dark" | "light";

/** What the chat surface is pointed at: the ongoing single conversation (the
 *  default — Vynel's "one brain"), a fresh topic, or one history session. */
export type ChatTarget = "continuous" | "fresh" | { sessionId: string };

/** What the canvas shows: the chat itself, a menu item's view (Application
 *  and Account globally; a feature section in a workspace), or an open file. */
export type ChatMainView =
  | "chat"
  | "application"
  | "account"
  | WorkspaceSectionId
  | { kind: "file"; filePath: string };

export interface ChatShellState {
  mainView: ChatMainView;
  target: ChatTarget;
}

const THEME_STORAGE_KEY = "vynel.theme";
const WORKSPACE_STORAGE_KEY = "vynel.active-workspace";

function readStoredTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" ? "light" : "dark";
}

// Shell UI state only (server state lives in vue-query). One home for how the
// window presents itself: theme, active workspace, the chat shells' view
// state, the session-list toggle, the voice overlay.
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

  // The workspace the Workspace tab shows — survives reloads so the user
  // returns to the room they were working in.
  const activeWorkspaceId = ref<string | null>(
    localStorage.getItem(WORKSPACE_STORAGE_KEY),
  );

  watch(activeWorkspaceId, (value) => {
    if (value === null) localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    else localStorage.setItem(WORKSPACE_STORAGE_KEY, value);
  });

  // The session-history list is opt-in (Chad's model): chat is ALWAYS the
  // continuous single conversation unless the user toggles the list open.
  const isSessionListOpen = ref(false);

  // The menu is a persistent panel sitting BEFORE the conversations panel;
  // its items render their views on the canvas (chat included).
  const isMenuOpen = ref(false);

  const globalChat = reactive<ChatShellState>({
    mainView: "chat",
    target: "continuous",
  });
  const workspaceChat = reactive<ChatShellState>({
    mainView: "chat",
    target: "continuous",
  });

  // Composer selections, shared by every chat surface — both the model
  // allowlist and the mode vocabulary are the real contract/session ones.
  const composerModelId = ref<string>(DEFAULT_CHAT_MODEL);
  const composerMode = ref<SessionMode>(DEFAULT_SESSION_MODE);

  // The Jarvis voice overlay — opens on the daemon's wake event or the mic button.
  const isVoiceOverlayOpen = ref(false);

  return {
    theme,
    toggleTheme,
    activeWorkspaceId,
    isSessionListOpen,
    isMenuOpen,
    globalChat,
    workspaceChat,
    composerModelId,
    composerMode,
    isVoiceOverlayOpen,
  };
});
