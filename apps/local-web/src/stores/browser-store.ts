import { computed, ref } from "vue";
import { defineStore } from "pinia";

/** One page open in the browser view: a workspace app (localhost:port) or a
 *  custom URL. */
export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  appId: string | null;
}

// The ONE home for what a tab may load: http(s) pages that are not the shell
// itself. Anything else empties to the enter-a-URL state — a javascript:/
// data:/file: src would execute in the SHELL's origin, and framing our own
// origin would let the page shed its sandbox and reach the parent.
function safeTabUrl(raw: string): string {
  if (raw === "") return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    if (parsed.origin === window.location.origin) return "";
    return raw;
  } catch {
    return "";
  }
}

// The lightweight browser view — a focus MODE over the shell (chat left,
// page right, chrome hidden), not a place. Runtime-only on purpose: closing
// the view restores the shell untouched, and a fresh session starts clean.
export const useBrowserStore = defineStore("browser", () => {
  const isOpen = ref(false);
  const tabs = ref<BrowserTab[]>([]);
  const activeTabId = ref<string | null>(null);

  const activeTab = computed(
    () => tabs.value.find((tab) => tab.id === activeTabId.value) ?? null,
  );

  function openView() {
    isOpen.value = true;
  }

  function closeView() {
    isOpen.value = false;
  }

  // Focus-or-create per app (an app has one live page — mirrors the scope
  // strip); custom URLs always open their own tab.
  function openTab(input: {
    url: string;
    title: string;
    appId?: string;
  }): BrowserTab {
    const appId = input.appId ?? null;
    const url = safeTabUrl(input.url);
    if (appId !== null) {
      const existing = tabs.value.find((tab) => tab.appId === appId);
      if (existing !== undefined) {
        existing.url = url;
        activeTabId.value = existing.id;
        return existing;
      }
    }
    const tab: BrowserTab = {
      id: crypto.randomUUID(),
      url,
      title: input.title,
      appId,
    };
    tabs.value.push(tab);
    activeTabId.value = tab.id;
    return tab;
  }

  function closeTab(tabId: string) {
    const index = tabs.value.findIndex((tab) => tab.id === tabId);
    if (index === -1) return;
    tabs.value.splice(index, 1);
    if (activeTabId.value === tabId)
      activeTabId.value = (tabs.value[index] ?? tabs.value[index - 1])?.id ?? null;
  }

  function activateTab(tabId: string) {
    if (tabs.value.some((tab) => tab.id === tabId)) activeTabId.value = tabId;
  }

  function setTabUrl(tabId: string, url: string, title?: string) {
    const tab = tabs.value.find((row) => row.id === tabId);
    if (tab === undefined) return;
    tab.url = safeTabUrl(url);
    if (title !== undefined) tab.title = title;
  }

  return {
    isOpen,
    tabs,
    activeTabId,
    activeTab,
    openView,
    closeView,
    openTab,
    closeTab,
    activateTab,
    setTabUrl,
  };
});
