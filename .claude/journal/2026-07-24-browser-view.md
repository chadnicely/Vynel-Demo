# 2026-07-24 — Browser view (lightweight, phase A)

Chad: "light browser view … browser icon → web view with tabs, user adds an app and sees it.
They can select any component, add note, send to claude session. Chat left, menus gone,
browser right; after closing all as it is. Kinda similar to claude design but light weight."
Scoped with him: NO Playwright (dropped entirely), no Tauri work — just the light web view.
Chat = the active scope tab's chat. New tab asks which app (or custom URL). Element picker =
a later phase.

## What shipped

- **`browser-store`** (runtime-only by design — the view is a MODE, not a place): page tabs
  `{id, url, title, appId}`; apps focus-or-create by appId, custom URLs always new; close
  hands focus to a neighbor; `setTabUrl` retargets/renames.
- **`BrowserPanel.vue`** — page tab strip + `+` menu (the room's RUNNING apps at
  `http://localhost:<port>`, stopped ones disabled, plus "Custom URL…"), address bar with
  scheme normalization (localhost→http, bare hosts→https), sandboxed `iframe` keyed by
  tab+reload counter, open-externally link, and the **Ask Claude** note drawer.
- **Note → chat**: the note writes `About "title" (url):\n<note>` into a new ui-store
  `composerSeed`; `AppComposer` consumes it one-shot into the draft (appends under any typed
  text, never auto-sends) — the user reviews, then sends.
- **Shell wiring**: Globe toggle in the title bar + palette entry; opening forces the scope's
  chat and collapses the tab strip + sidebar (dynamic grid rows); a right `ResizablePanel`
  hosts the panel; closing restores everything (pure v-if/state).
- `useWorkspaceApps` now accepts a null workspaceId (query idle) — the Global tab has no apps.

## Native webview round (same day)

Chad hit the iframe wall immediately — google.com renders blank (X-Frame-Options). "As it's
a desktop app, yes that's what I asked to implement." So the page now renders in a NATIVE
Tauri child webview on desktop; the iframe stays as the browser-dev fallback.

- **Rust** (`apps/desktop/src-tauri/src/browser.rs`, first real commands in the thin shell):
  `browser_open` (idempotent create-or-navigate at logical bounds) / `navigate` /
  `set_bounds` / `set_visible` / `close`, child webview `embedded-browser` on the main
  window; `tauri` gains the `unstable` feature (multiwebview). Hard guard in Rust too:
  http(s) only.
- **`use-embedded-browser.ts`** — the withGlobalTauri seam (no npm dep, no-op in a plain
  browser, mirrors `use-window-controls`): glues the webview to the viewport div's rect
  (CSS px = logical px) via ResizeObserver; tracks url + obscured; closes on unmount.
- **Z-order discipline** — a native webview draws above ALL HTML. Shell overlays (palette,
  dialogs, voice, activity monitor) and the panel's own dropdowns report into
  `browser.isObscured` → the page hides while they're up. Approval/Ask toasts instead DOCK
  LEFT over the chat in browser mode (`.dock-start`) — an approval card must never be
  invisible behind a web page.

## Learnings

- The apps feature already carried everything the browser needed (`port` → localhost URL,
  live run status for the menu) — zero backend work for phase A.
- An `iframe` inside the existing Tauri webview IS the lightweight browser — no extra
  webview windows, no plugin. The honest limitation (some sites refuse to embed) is stated
  in the empty-state copy, with open-externally always one click away.
