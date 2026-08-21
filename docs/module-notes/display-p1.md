# Display — P1, the room (2026-08-21)

Kafi accepted every recommendation in `display-research.md`. P1 = the Display view itself: the orb, the
panels on live status, the top strip, the top-bar toggle that starts the in-app voice session and shows the
Display. No schema, no tools, no widgets yet (empty slots where they will land). Branch `feature/display-p1`
(worktree `.claude/worktrees/display-p1`, band 18940).

## Locked for P1

- **Name:** Display (tab/toggle label "Display"; the menu may read "Display Console"). Never "HUD" or a borrowed hero name in code.
- **Dark-only surface.** The orb's additive (`lighter`) glow defines the look; the Display paints its own dark ground
  and its own four-colour palette exposed as CSS variables (`--display-accent`, `--display-accent-dim`,
  `--display-accent-faint`, `--display-text`) so re-tokening is one place. Everything outside the Display keeps both
  themes.
- **Voice = the in-app web leg** (`use-voice-session.ts` + `VoiceStage` derivations) — the PRIMARY path (recognition
  accuracy). The toggle starts that session; the wake word keeps using the daemon + voice window (P3 wires
  wake-opens-app).
- **The Display is a global canvas view** (`ChatMainView` gains `'display'`; `GlobalChatView.vue` branches on it
  like `voice-chat`), not a route — the tab model stays.
- **Orb reactivity from the in-app session:** `listening` while the recognizer is open, `speaking` while the player
  plays, `spike()` on every spoken clause start (the player knows when each sentence starts), `energy` from the
  overall status (working turns → high, needs-input → mid, idle → low). Exact mapping in the orb-state derivation
  file; one home.
- **Panels read existing sources only** — `use-voice-chat-status`, the sessions overview / `use-workspace-status`
  rollup, `use-working-rail` entities, pending approvals + asks, `use-dashboard-overview` if it has what the strip
  needs. No new channel, no polling loops of our own beyond what those composables already do.
- Stop everything on unmount (the demo's orb runs forever — ours must not).

## Component contract (two agents, disjoint paths)

**Agent A — `packages/ui/src/display/`** (pure, no app imports, tests in vitest `ui` project):
- `orb-renderer.ts` — `createOrbRenderer(canvas: HTMLCanvasElement, options?: { palette?: OrbPalette; moteCount?: number }): OrbRenderer`
  with `OrbRenderer = { setEnergy(v: number): void; setListening(on: boolean): void; setSpeaking(on: boolean): void; spike(strength?: number): void; stop(): void }`.
  Port of the demo's `makeCore` (`.tmp/vynel-mission-control/js/hud.js:122-292`): canvas 2D, pre-rendered
  sprites, eased targets, ring segments, shockwaves. Changes: `ResizeObserver` (no per-frame `clientWidth`),
  DPR cap 2, `stop()` cancels the rAF + disconnects the observer, the 87 shadow-blurred ring strokes per frame
  cheapened (one shadow pass or no shadow), palette injectable (default = the demo's cyan). No DOM outside the
  canvas. Test the state machine + stop via a fake canvas/rAF where possible (the renderer must not throw under
  jsdom with a mocked 2D context).
- `DisplayOrb.vue` — wraps the renderer: props `{ energy: number; listening: boolean; speaking: boolean; spikeKey?: number }`
  (a changing `spikeKey` triggers one `spike()`), emits nothing, sizes to its box, `onUnmounted → stop()`.
- `DisplayPanel.vue` — props `{ title: string; rows: ReadonlyArray<{ label: string; value: string; tone?: 'default' | 'attention' | 'live' | 'muted' }> }`,
  the corner-tick chrome from the demo (`hud.js:72-81`), monospace, small caps labels. Default slot for custom
  bodies (the telemetry log).
- `DisplayStrip.vue` — the top strip: props `{ brand: string; subtitle: string; linked: boolean; building: number; needYou: number; clock: string }`
  + a slot on the right for the voice pills (listening/voice off) — the buttons themselves are B's (they bind to the
  session); the strip only lays them out.
- `index.ts` re-exports; `packages/ui/src/index.ts` re-exports the display group. Styling via the four CSS
  variables on a `.display-root` class (the grid background + scanline CSS from `hud.js:49-64` ported as scoped
  CSS). Tailwind where the repo uses it, scoped CSS for the effects.

**Agent B — `apps/local-web/src/`** (codes against the contract above; imports from `@vynel/ui`):
- `views/display/DisplayView.vue` — the room: `DisplayStrip` on top, left column (`System`, `Telemetry`), the
  orb stage in the middle, right column (`Account`, `Legend` → make Legend our status legend: needs you /
  working / idle), empty `left|stage|right` widget slots rendered as subtle placeholders with a one-line hint
  ("Claude can put reports here" — P2). Listening / voice pills bound to the session (`start`/`end`, mute).
- `composables/display/use-display-status.ts` — ONE derivation home: `{ linked, building, needYou, systemRows,
  accountRows, telemetry, orbEnergy }` from the existing composables (see Locked). Telemetry = a capped ring
  (14) of recent activity lines derived from the activity store's turn begin/end + approvals/asks — no new
  server calls.
- `composables/display/display-orb-state.ts` — pure: `(view: VoiceCommandSessionView, status, isDaemonSpeaking)`
  → `{ energy, listening, speaking }`, plus the clause-start → `spikeKey` bump (hook the spoken-audio player's
  per-sentence start; if no event exists, add a tiny `onSentenceStart` callback to the player — that is the one
  allowed touch in `composables/voice/`).
- Canvas view: `stores/ui-store.ts` `ChatMainView` += `'display'`; `GlobalChatView.vue` branch; AppShell
  `selectSection`/`runCommand` get `display` (+ command palette entry). **Top-bar toggle** in
  `components/shell/AppTitleBar.vue` right icon row (tasks-toggle precedent): on → start the in-app voice session
  (`ui.isVoiceOverlayOpen` is NOT used — the Display owns the orb; the overlay must not also open) + switch to
  the Display; off → end the session, return to the previous view. While the Display is active the
  `VoiceOverlay` stays hidden (guard in `AppShell.vue:786` mount or in the overlay's own `v-if`).
  **Superseded 2026-08-21 (P3):** the session is no longer the room's — the switch is the real voice on/off and
  the session lives in `composables/display/use-display-voice.ts`, one per window (see the P3 note). The
  overlay's guard is now `!displayVoice.ownsVoice`, which covers a session still running behind another view.
- Tests: view renders the three columns + slots; status derivation (all branches); orb-state mapping; toggle
  starts/ends the session and switches the view; overlay suppressed while Display is active.

Rules: house rules (CLAUDE.md); every change ships tests; targeted vitest/tsc only (the lead runs the gate); no
commits (the lead commits); `git status` shows only your paths at hand-back; ≤ 40-line hand-back.

## Acceptance (P1)

- Top-bar "Display" → the room opens, the orb breathes, the mic is live (browser leg), speaking makes the orb
  pulse and spike per clause, the strip's counters and the panels reflect real status, no overlay double-orb.
- Leaving the Display stops the renderer (no rAF after unmount); toggling off ends the session. *(P3: leaving
  the Display no longer ends the session — only the switch does. The renderer half still holds.)*
- Dark ground regardless of app theme; nothing outside the Display changes.
