import { reactive, ref, watch } from "vue";
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

const THEME_STORAGE_KEY = "vynel.theme";
const WORKSPACE_STORAGE_KEY = "vynel.active-workspace";
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

// Shell UI state only (server state lives in vue-query). One home for how the
// window presents itself: theme, active workspace, the chat shells' view
// state, the tasks dock, the voice overlay.
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

  // The tasks dock is opt-in, off by default — chat stays the whole story
  // until the user asks for the list.
  const isTasksPanelOpen = ref(false);

  // The plan being viewed in the SHARED PlanViewDialog (AppShell mounts it once)
  // — set from a chat `vynel://plan/<id>` link, a list row's View action, or a
  // task's plan chip; null = closed. One home so every surface opens the same
  // review dialog.
  const viewingPlanId = ref<string | null>(null);

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
    activeWorkspaceId,
    isTasksPanelOpen,
    viewingPlanId,
    globalChat,
    workspaceChat,
    composerModelId,
    composerMode,
    composerThinkingEffort,
    isVoiceOverlayOpen,
  };
});
