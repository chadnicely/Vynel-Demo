import { onBeforeUnmount, ref, watch } from "vue";
import type { Ref } from "vue";

// The native embedded-browser seam (desktop only). Real sites refuse to be
// iframed (X-Frame-Options), so on desktop the page renders in a NATIVE
// child webview that this composable keeps glued to a viewport element's
// rectangle. Driven over the `withGlobalTauri` global — no Tauri npm
// dependency, and outside the shell everything no-ops so the caller keeps
// its iframe fallback (see the sibling shell/use-window-controls.ts seam).

interface TauriCore {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
}

function findTauriCore(): TauriCore | null {
  const core = (window as { __TAURI__?: { core?: TauriCore } }).__TAURI__?.core;
  return core ?? null;
}

export interface EmbeddedBrowser {
  /** True when the native webview drives the page (Tauri); false = iframe. */
  readonly isNative: boolean;
  /** Bind to the page-area element; the webview tracks its rectangle. */
  readonly viewport: Ref<HTMLElement | null>;
  /** Open-or-navigate the page at the viewport's current bounds. */
  show(url: string): void;
  /** No page to show (empty tab) — the webview hides, nothing closes. */
  hide(): void;
  /** Shell overlays (palette, dialogs, menus) draw UNDER a native webview —
   *  they report themselves here and the page yields until they close. */
  setObscured(value: boolean): void;
  close(): void;
}

export function useEmbeddedBrowser(): EmbeddedBrowser {
  const core = findTauriCore();
  const viewport = ref<HTMLElement | null>(null);

  if (core === null) {
    return {
      isNative: false,
      viewport,
      show: () => {},
      hide: () => {},
      setObscured: () => {},
      close: () => {},
    };
  }

  // A command failing against a closing window or an already-closed webview
  // is lifecycle noise, never actionable — swallow, like the window controls.
  const attempt = (action: Promise<unknown>): void => {
    void action.catch(() => {});
  };

  let currentUrl = "";
  let isObscured = false;

  function bounds(): { x: number; y: number; width: number; height: number } | null {
    const rect = viewport.value?.getBoundingClientRect();
    if (rect === undefined || rect.width === 0 || rect.height === 0) return null;
    // CSS pixels ARE Tauri logical pixels — no DPR math here.
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }

  function syncVisibility() {
    attempt(
      core!.invoke("browser_set_visible", {
        visible: currentUrl !== "" && !isObscured,
      }),
    );
  }

  function show(url: string) {
    const rect = bounds();
    if (rect === null) return;
    currentUrl = url;
    // browser_open is idempotent: it creates the webview the first time and
    // navigates + repositions it afterwards (which is also the reload path).
    // Visibility rides along so an obscured page never flashes over an
    // overlay between two IPC calls.
    attempt(
      core!.invoke("browser_open", { url, ...rect, visible: !isObscured }),
    );
  }

  function hide() {
    currentUrl = "";
    syncVisibility();
  }

  function setObscured(value: boolean) {
    isObscured = value;
    syncVisibility();
  }

  function close() {
    currentUrl = "";
    attempt(core!.invoke("browser_close"));
  }

  // The webview follows the viewport. ResizeObserver catches the element's
  // own box changing (divider drags); the window listener catches the case
  // it can't — a horizontal window resize that MOVES the right-anchored
  // panel without changing its size.
  function syncBounds() {
    if (currentUrl === "") return;
    const rect = bounds();
    if (rect !== null) attempt(core!.invoke("browser_set_bounds", rect));
  }

  let observer: ResizeObserver | null = null;
  watch(viewport, (element) => {
    observer?.disconnect();
    observer = null;
    if (element === null) return;
    observer = new ResizeObserver(syncBounds);
    observer.observe(element);
  });
  window.addEventListener("resize", syncBounds);

  onBeforeUnmount(() => {
    window.removeEventListener("resize", syncBounds);
    observer?.disconnect();
    close();
  });

  return { isNative: true, viewport, show, hide, setObscured, close };
}
