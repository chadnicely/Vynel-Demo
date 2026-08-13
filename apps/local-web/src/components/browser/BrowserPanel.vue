<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  PhArrowSquareOut as ExternalLink,
  PhGlobe as Globe,
  PhChatCircleText as MessageSquarePlus,
  PhPlus as Plus,
  PhArrowClockwise as RotateCw,
  PhX as X,
} from "@phosphor-icons/vue";
import { DropdownMenu, EmptyState, IconButton } from "@vynel/ui";
import type { MenuItemModel } from "@vynel/ui";
import { useBrowserStore } from "../../stores/browser-store.js";
import { useUiStore } from "../../stores/ui-store.js";
import { useWorkspaceApps } from "../../composables/workspace-apps/use-workspace-apps.js";
import { useEmbeddedBrowser } from "../../composables/browser/use-embedded-browser.js";

// The lightweight browser panel (right side of browser mode): small page
// tabs, an address bar, and the page in a sandboxed iframe. `+` offers the
// active room's apps (their localhost pages) or a custom URL. "Ask Claude"
// drops a note about the open page into the chat composer on the left —
// the user reviews and sends; nothing auto-sends.
const browser = useBrowserStore();
const ui = useUiStore();

const workspaceId = computed(() => ui.activeTab.workspaceId);
const appsQuery = useWorkspaceApps(() => workspaceId.value);
const apps = computed(() => appsQuery.data.value ?? []);

const addMenu = computed<MenuItemModel[]>(() => [
  ...(apps.value.length > 0
    ? [{ id: "apps-label", kind: "label" as const, label: "Apps" }]
    : []),
  ...apps.value.map((app) => {
    const isOpenable =
      app.runtime?.status === "running" && app.port !== null;
    return {
      id: `app:${app.id}`,
      label: isOpenable ? app.name : `${app.name} (not running)`,
      disabled: !isOpenable,
    };
  }),
  ...(apps.value.length > 0
    ? [{ id: "sep", kind: "separator" as const }]
    : []),
  { id: "custom-url", label: "Custom URL…" },
]);

const addressInput = ref<HTMLInputElement | null>(null);
const addressDraft = ref("");

// The address bar mirrors the active tab; switching tabs re-seeds it.
watch(
  () => browser.activeTab?.url ?? "",
  (url) => {
    addressDraft.value = url;
  },
  { immediate: true },
);

function onAddMenuSelect(itemId: string) {
  if (itemId === "custom-url") {
    browser.openTab({ url: "", title: "New tab" });
    void nextTick(() => addressInput.value?.focus());
    return;
  }
  if (!itemId.startsWith("app:")) return;
  const app = apps.value.find((row) => row.id === itemId.slice(4));
  if (app === undefined || app.port === null) return;
  browser.openTab({
    url: `http://localhost:${app.port}`,
    title: app.name,
    appId: app.id,
  });
}

// Bare hosts get https:// — localhost gets http:// (no cert there).
function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "" || /^https?:\/\//i.test(trimmed)) return trimmed;
  return /^(localhost|127\.0\.0\.1)([:/]|$)/i.test(trimmed)
    ? `http://${trimmed}`
    : `https://${trimmed}`;
}

function onAddressSubmit() {
  const tab = browser.activeTab;
  const url = normalizeUrl(addressDraft.value);
  if (url === "") return;
  addressDraft.value = url;
  if (tab === null) {
    browser.openTab({ url, title: hostOf(url) });
    return;
  }
  // A custom tab renames to where it went; an app tab keeps its app name.
  browser.setTabUrl(
    tab.id,
    url,
    tab.appId === null ? hostOf(url) : undefined,
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    // Mid-typing junk — the raw text is still the honest tab name.
    return url;
  }
}

// ── The page surface. Desktop: a NATIVE child webview glued to the viewport
// div (real sites refuse iframes; a native webview loads anything). Browser
// dev: the sandboxed iframe fallback below. ──
const native = useEmbeddedBrowser();

watch(
  () => (browser.isOpen ? (browser.activeTab?.url ?? "") : ""),
  (url) => {
    if (!native.isNative) return;
    if (url === "") native.hide();
    // Waits a tick so a freshly-mounted viewport div has real bounds.
    else void nextTick(() => native.show(url));
  },
  { immediate: true },
);

// The panel's own dropdowns portal OVER the page area — count them as
// obscuring, along with whatever the shell reports (palette, dialogs).
const openPanelMenuCount = ref(0);

function onMenuOpenChange(open: boolean) {
  openPanelMenuCount.value += open ? 1 : -1;
}

watch(
  () => browser.isObscured || openPanelMenuCount.value > 0,
  (obscured) => native.setObscured(obscured),
  { immediate: true },
);

// Bumping the key remounts the iframe — the only reload a cross-origin
// frame allows us. Native reload = re-show (navigates in place).
const reloadCount = ref(0);

function reloadPage() {
  if (native.isNative) {
    const url = browser.activeTab?.url ?? "";
    if (url !== "") native.show(url);
    return;
  }
  reloadCount.value += 1;
}

// ── "Ask Claude" — the note lands in the LEFT chat's composer as a draft. ──
const isNoteOpen = ref(false);
const noteDraft = ref("");
const noteInput = ref<HTMLTextAreaElement | null>(null);

function toggleNote() {
  isNoteOpen.value = !isNoteOpen.value;
  if (isNoteOpen.value) void nextTick(() => noteInput.value?.focus());
}

function sendNote() {
  const tab = browser.activeTab;
  const note = noteDraft.value.trim();
  if (tab === null || note === "") return;
  ui.composerSeed = `About "${tab.title}" (${tab.url}):\n${note}`;
  noteDraft.value = "";
  isNoteOpen.value = false;
}
</script>

<template>
  <section class="flex h-full min-w-0 flex-col bg-shell" aria-label="Browser view">
    <!-- Page tabs -->
    <div class="flex h-9 shrink-0 items-center gap-1 border-b border-hair px-2 select-none">
      <div
        v-for="tab in browser.tabs"
        :key="tab.id"
        class="group flex h-7 max-w-44 min-w-0 items-center rounded-sm transition"
        :class="
          tab.id === browser.activeTabId
            ? 'bg-row-active text-ink-1'
            : 'text-ink-2 hover:bg-row-hover hover:text-ink-1'
        "
      >
        <button
          type="button"
          class="flex min-w-0 items-center gap-1.5 py-1 pl-2 pr-1 text-sm"
          @click="browser.activateTab(tab.id)"
        >
          <Globe :size="12" class="shrink-0 text-ink-3" />
          <span class="truncate">{{ tab.title }}</span>
        </button>
        <button
          type="button"
          :aria-label="`Close ${tab.title}`"
          class="mr-1 grid size-5 shrink-0 place-items-center rounded-sm text-ink-3 opacity-0 transition hover:bg-row-hover hover:text-ink-1 group-hover:opacity-100 focus-visible:opacity-100"
          @click.stop="browser.closeTab(tab.id)"
        >
          <X :size="11" />
        </button>
      </div>

      <DropdownMenu
        :items="addMenu"
        align="start"
        @select="onAddMenuSelect"
        @update:open="onMenuOpenChange"
      >
        <template #trigger>
          <button
            type="button"
            aria-label="Open a page"
            title="Open a page"
            class="grid size-7 shrink-0 place-items-center rounded-sm text-ink-3 transition hover:bg-row-hover hover:text-ink-1 data-[state=open]:bg-row-active data-[state=open]:text-ink-1"
          >
            <Plus :size="14" />
          </button>
        </template>
      </DropdownMenu>

      <span class="flex-1" />

      <IconButton label="Close browser view" @click="browser.closeView()">
        <X :size="15" />
      </IconButton>
    </div>

    <!-- Address bar + page actions -->
    <div
      v-if="browser.activeTab !== null"
      class="flex h-10 shrink-0 items-center gap-1.5 border-b border-hair px-2"
    >
      <IconButton label="Reload page" @click="reloadPage">
        <RotateCw :size="14" />
      </IconButton>
      <form class="min-w-0 flex-1" @submit.prevent="onAddressSubmit">
        <input
          ref="addressInput"
          v-model="addressDraft"
          type="text"
          inputmode="url"
          placeholder="Enter a URL…"
          aria-label="Page address"
          class="w-full rounded-sm border border-hair bg-raised px-2.5 py-1 text-sm text-ink-1 outline-none placeholder:text-ink-3 focus:border-ink-3"
        />
      </form>
      <a
        v-if="browser.activeTab.url !== ''"
        :href="browser.activeTab.url"
        target="_blank"
        rel="noreferrer"
        aria-label="Open externally"
        title="Open in your browser"
        class="grid size-7 shrink-0 place-items-center rounded-sm text-ink-3 transition hover:bg-row-hover hover:text-ink-1"
      >
        <ExternalLink :size="14" />
      </a>
      <IconButton
        label="Ask Claude about this page"
        :active="isNoteOpen"
        @click="toggleNote"
      >
        <MessageSquarePlus :size="15" />
      </IconButton>
    </div>

    <!-- The note drawer — writes a draft into the chat composer, never sends. -->
    <div v-if="isNoteOpen && browser.activeTab !== null" class="shrink-0 border-b border-hair p-2">
      <textarea
        ref="noteInput"
        v-model="noteDraft"
        rows="2"
        placeholder="What should Claude change on this page?"
        aria-label="Note for Claude"
        class="w-full resize-none rounded-sm border border-hair bg-raised px-2.5 py-1.5 text-sm text-ink-1 outline-none placeholder:text-ink-3 focus:border-ink-3"
        @keydown.enter.exact.prevent="sendNote"
      />
      <div class="mt-1.5 flex items-center justify-between">
        <p class="text-xs text-ink-3">Lands in the chat draft — review, then send.</p>
        <button
          type="button"
          aria-label="Add note to chat"
          class="rounded-sm bg-row-active px-2.5 py-1 text-xs text-ink-1 transition hover:bg-row-hover"
          @click="sendNote"
        >
          Add to chat
        </button>
      </div>
    </div>

    <!-- The page -->
    <div class="relative min-h-0 flex-1">
      <EmptyState
        v-if="browser.activeTab === null"
        class="h-full"
        title="Open an app or a page"
        hint="Use + to open one of this room's apps, or a custom URL. Some sites refuse to embed — those open externally."
      >
        <template #icon>
          <Globe :size="22" />
        </template>
      </EmptyState>
      <EmptyState
        v-else-if="browser.activeTab.url === ''"
        class="h-full"
        title="Enter a URL above"
        hint="The page renders right here. If it stays blank, the site refused to embed — use Open externally."
      >
        <template #icon>
          <Globe :size="22" />
        </template>
      </EmptyState>
      <!-- Desktop: the native webview renders OVER this surface, glued to
           its rectangle; the div is the measuring stick (and what shows in
           the beat while an overlay hides the page). -->
      <div
        v-else-if="native.isNative"
        :ref="(el) => (native.viewport.value = el as HTMLElement | null)"
        class="h-full w-full"
        data-testid="native-page-viewport"
      />
      <iframe
        v-else
        :key="`${browser.activeTab.id}:${reloadCount}`"
        :src="browser.activeTab.url"
        :title="browser.activeTab.title"
        class="h-full w-full border-0 bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      />
    </div>
  </section>
</template>
