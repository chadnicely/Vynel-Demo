# Jarvis HUD — research (2026-08-21)

Kafi's brief: bring the mission-control demo's **HUD tab** (`.tmp/vynel-mission-control`, `index.html` → `js/hud.js`)
into the app. A **top-bar toggle** enables voice and shows the HUD; a **wake word** should open the app and switch to
it. While voice is connected and the user is on another view, a **mini** HUD sits where the desktop-control progress
UI sits (stacked above it when both are on). The HUD can host **widgets** (reports / data) that Claude adds, updates
and removes **in realtime**. Three read-only research passes (demo internals · app seams · widget design) — this is
the synthesis. No code yet.

## 1. What the demo actually is

- One self-contained vanilla file, `js/hud.js` (618 lines, IIFE, no libs, no build). Tab switch is `.gone`
  (opacity 0), so once visited its loops run forever on every tab — a Vue port fixes this for free (`onUnmounted`).
- **The orb is the prize:** `makeCore(canvas)` (`hud.js:122-292`) — canvas 2D, 1700 motes drawn `lighter` from four
  pre-rendered sprites, eased targets, API `{ setEnergy(0..1), setListening(bool), pulse(bool), spike(v), stop() }`.
  Ports almost mechanically to `class OrbRenderer`. Two fixes on port: `ResizeObserver` instead of a per-frame
  `clientWidth` read; call `stop()` on unmount. Cost hot-spot: 87 shadow-blurred arc strokes per frame (`segRing`) —
  first thing to cheapen. `setEnergy(1)` has never actually been exercised in the demo (its "building" status is
  unreachable on `index.html`) — drive it to 1.0 once and look.
- Panels are hand-written (`panel()` / `line()` closures, no registry); data comes from a 15 s poll of a local
  connector — **no live path, no WebSocket**. The pattern ports to `<HudPanel rows=…>`; the tree does not.
- LISTEN / VOICE OFF are real Web Speech both ways; the trick worth keeping is `utterance.onboundary → core.spike()`
  per word — the orb "mouths" the sentence. Our TTS is server-synthesized and clause-chunked, so we spike per spoken
  clause (we already know when each sentence starts playing).
- Palette is four constants (`CY #4fd8ff`, dims, text `#cdf3ff`, bg `#02132b → #010a1c`), monospace stack; it
  ignores the demo's own token system. Re-tokening is ~10 lines. The look depends on `lighter` compositing →
  **dark-only surface** (a light HUD would need a different orb).
- Provenance: no LICENSE/headers; two in-project commits; only CDN deps (Phosphor icons MIT, Inter OFL) — nothing
  vendored. `design/` is generated Claude Design output — never port it.

## 2. Where it lands in our app (seams, all verified)

- **Top-bar toggle:** `AppTitleBar.vue:209-249` right icon row (the tasks toggle at `:211-224` is the precedent);
  shell command ids in `AppShell.vue:542-600` (`start-voice` already sets `ui.isVoiceOverlayOpen`). The HUD is a
  **global canvas view** (`ChatMainView` in `ui-store.ts:32-49` + a branch in `GlobalChatView.vue:332-453`, like
  `voice-chat`) or a non-bare route — the canvas view keeps the tab model; recommend canvas view.
- **Voice in-app today:** `VoiceOverlay.vue` (teleported, z-60) over `use-voice-session.ts` (`view{state, transcript,
  spokenText, notice}`, `isActive`, `start/end`, `currentSessionId`, `speakExternal`) + `use-voice-daemon-link.ts`
  (wake, daemon speaking, session end). `VoiceStage.vue` + `voice-stage-view.ts` are pure presentation and reusable at
  any orb size. The Tauri MAIN window deliberately declares **no wake capability** (the voice-routing fix) — the
  toggle starts a manual in-app session; the wake path goes through the Jarvis window.
- **Wake opens the app — no new Rust:** `main.rs:44-52` single-instance handler already calls
  `open_main_window()` when the exe is launched WITHOUT `--jarvis-only`; the daemon only ever spawns with it
  (`jarvis-window.ts:108`). An argless spawn = "wake opens the app". Switching to the HUD view = a frame to the
  app (the `voice` live channel already reaches the main window).
- **The mini dock is CROSS-WINDOW:** the desktop-control progress UI is its own always-on-top transparent Tauri window
  (`windows.rs:96-106`, 380×360, parked bottom-right by `tauri-overlay-window.ts:54-69`). "Same position, stacked
  above" is therefore an OS-window statement, not CSS. Note the **Jarvis window already IS such a window**
  (`windows.rs:75-89`, 420×560, always-on-top, transparent, reveals on wake, parks center).
- **Live data — no new channel needed for status:** compose `activity` (turn frames, replayed on subscribe),
  `voice:<surface>` (daemon state), `GET /root/voice-chat/status`, the sessions overview, approvals/asks — exactly
  what the working rail and desktop fold do. A **`hud` channel IS needed for widgets** (5 touch points:
  `live-channel.ts` keys/parse/frames, hub source, the exhaustive authorizer switch in `live-channel-route.ts:41`).
  The client store dispatches by `frame.channel` — no change.
- **In-window stacking precedents** if any part stays in-window: `ApprovalNotifier.vue` (fixed bottom-right, z-50,
  `.dock-start` flip), `AskNotifier.vue` `.beside-approvals` — and the `browser.isObscured` watch (the native
  browser webview paints above all HTML).

## 3. Widgets — design + the safety verdict

- **Leaf `@vynel/hud`** (customization-shaped): `hud_widgets` { id, userId (kernel FK), scopeKey `'global'|workspaceId`
  (loose), title, kind, contentJson (discriminated on kind), slot `left|stage|right|dock`, size `sm|md|lg`, sortOrder,
  createdBySessionId (loose), expiresAt?, timestamps }. Functional repos; every mutation = ONE `withTransaction`
  writing the row + the outbox event (`create-ask-request.ts:37-60` verbatim). Limits as shared consts: 32 KB content,
  80-char title, 12 widgets per scope (oldest evicted; the eviction emits its own removed). **Persist** (a HUD that
  empties on relaunch is a toy); sweep `expiresAt` at boot + lazily on list. Layout = named slots on the row — the
  model can reason about "put the chart on the stage", never about pixels; user rearrangement later via
  customization's JSON, separable.
- **Live push:** the outbox relay ticks every 5 s — too slow for "appears as Claude says it". Co-commit the event AND
  fan out in-process from the route through an injected `HudLiveSink` (the leaf may not import `@vynel/session`; the
  `waitGate` injection precedent). One per-user `hud` channel (auth = "your own"; the view filters by scope).
- **MCP = path A (x-mcp routes), not a descriptor:** `GET /hud/widgets` `hud_list_widgets` · `POST /hud/widgets`
  `hud_add_widget` · `PATCH /hud/widgets/:id` `hud_update_widget` · `POST /hud/widgets/:id/remove`
  `hud_remove_widget` (POST, not DELETE — DELETE auto-joins the ask tier, and a card to take a chart down kills the
  HUD) · `POST /hud/clear` `hud_clear_widgets`. Surfaces root + workspace-interactive (voice rides root). Card class
  **never** (reversible UI the user is looking at). Gate behind a `hud` capability (default on). The tool description is
  the UX: a glanceable board for reports/tables/numbers the user will keep looking at (especially on voice); never
  instead of answering; list-then-update over near-duplicates.
- **Model-authored HTML — the threat model is not ordinary XSS.** `tauri.conf.json` has `withGlobalTauri: true` and
  `csp: null`; the local API has no auth in local mode and no CORS; a script in the app origin owns the whole API +
  the Tauri bridge (engine config writes, updater installs). Therefore model markup may never execute in the app
  origin. Options: (a) `iframe srcdoc sandbox=""` — safe, no charts, theme by serializing tokens into the srcdoc;
  (b) sandbox + scripts without same-origin — still a no-cors POST CSRF vector against the unauthenticated API →
  **reject**; (c) constrained kinds rendered by OUR components — `MarkdownText.vue` (markdown-it + DOMPurify + shiki)
  exists, the `--chart-1..4` tokens are validated in both themes; (d) hybrid.
  **Recommendation: (d) — ship `markdown | table | metric | chart` now; `html` later, only after** a real CSP in
  `tauri.conf.json` + a CSP header from `static-web-ui.ts` + `sandbox=""` + a per-frame `csp`. Do NOT copy
  `BrowserPanel.vue:332` (`allow-scripts allow-same-origin` = sandbox no-op; right for its threat model, wrong here).

## 4. Recommended shape + phases

**The mini dock = the Jarvis window in "mini mode".** It is already the always-on-top transparent OS window that
reveals on wake; give it a second parking spot (bottom-right, offset above the desktop-control window when that one
is visible — both use `createOverlayWindowControls`; add a stacking offset) and a compact `VoiceStage` at a small
orb. Rule: HUD view active in-app → the Jarvis window hides (the in-app HUD owns the orb); user on any other view
while a voice session is live → the Jarvis window shows mini, bottom-right. No third window, no new capability file.

| Phase | Delivers | Size |
|---|---|---|
| **P1 — the HUD room** | `OrbRenderer` (ported, tokened, dark-only, stops on unmount, spikes per spoken clause) · `HudPanel`/`HudRow` · top strip (LINKED · N building · N need you · clock) · panels wired to existing status sources (voice status, overview, rail entities, approvals/asks) · HUD as a global canvas view · top-bar toggle (starts the in-app voice session + shows the HUD) · empty widget slots | ~2 days, no schema, no tools |
| **P2 — widgets** | P2a `@vynel/hud` + migration · P2b routes + x-mcp + gates + census · P2c `hud` live channel + injected sink + `use-hud-widgets` · P2d renderers (markdown/table/metric/chart) · instruction steer (global-root + voice-turn: "one sentence, detail on the HUD") | ~3 days, four gated slices |
| **P3 — presence** | Jarvis-window mini mode (bottom-right, stacked above desktop-control) · wake opens the app (argless spawn → single-instance handler) + a switch-to-HUD frame · orb reactivity from `voice:<surface>` listen-only | ~2 days |
| **Later / gated** | `kind: 'html'` behind the CSP prerequisites · user rearrangement · light theme (needs a different orb) | — |

## 5. Decisions for Kafi

1. Mini dock = Jarvis window mini mode (recommended) vs a new third OS window vs an in-window card.
2. Widgets: persist + 12/scope cap + named slots; ship four safe kinds now, raw `html` later behind CSP work — OK?
3. HUD tools never card; `remove`/`clear` as POST routes (no approval card to tidy the board) — OK?
4. HUD is dark-only (the orb's compositing) — OK, or is a light variant required?
5. Voice via the toggle = the in-app browser leg (Web Speech in WebView2); the native daemon leg stays the wake path — OK?
6. Phase order P1 → P2 → P3 as above, or widgets before presence?
