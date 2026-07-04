import { ref, watch } from "vue";
import { defineStore } from "pinia";

export type Theme = "dark" | "light";

const THEME_STORAGE_KEY = "vynel.theme";

function readStoredTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" ? "light" : "dark";
}

// Shell UI state only (server state lives in vue-query). Grows drawer/panel
// state as the shell grows — one home for how the window presents itself.
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

  return { theme, toggleTheme };
});
