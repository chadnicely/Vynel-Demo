# Display — P3, presence (plan, 2026-08-21)

P1 = the room, P2 = widgets. P3 makes the Display *present* when you are not looking at it: the **display dock**
(the mini Display where the desktop-control window sits, stacked above it), **wake opens the app** and switches
it to the Display, and the orb reacting to the daemon leg. Decisions from `display-research.md` §5 (accepted):
the dock is the existing always-on-top voice window in a mini mode — no third window; the in-app web speech leg
stays primary, the daemon leg is the wake path.

## Today's pieces (verified in research §2)

- The voice window: Tauri label `display-dock` (`windows.rs:75-89`, 420×560, transparent, always-on-top, skip-taskbar,
  hidden until wake), route `/display-dock` → `views/DisplayDockView.vue` (`createOverlayWindowControls`, `parkCenter()`,
  `reveal()/dismiss()` on wake/end, title "Vynel Display" which the daemon's `focus()` matches by name), launched by
  the daemon with `--dock-only` (`apps/voice/src/overlay/display-dock-window.ts:108`), env `VYNEL_VOICE_DOCK_*`,
  capability file `capabilities/display-dock.json`.
- The desktop-control window: label `desktop-overlay` (`windows.rs:96-106`, 380×360), parked bottom-right by
  `tauri-overlay-window.ts:54-69` (`CORNER_MARGIN = 16`), shown/hidden by `desktop-activity-fold.ts:317-321`
  (`isDesktopOverlayVisible`: running step / pending approval / 20 s after activity).
- Wake → app: `main.rs:44-52` single-instance handler calls `open_main_window()` on an argless second launch —
  nobody exercises it. The main window declares NO wake capability (deliberate, voice-routing slice).

## Naming — DECIDED (Kafi): full rename, SHIPPED

The product rule is "no borrowed hero names", and the dock IS the Display's mini form. Renamed in one slice:

| old | new |
|---|---|
| Tauri window label `jarvis` | `display-dock` |
| route `/jarvis`, `views/JarvisView.vue` | `/display-dock`, `views/DisplayDockView.vue` |
| window title "Vynel Jarvis" | "Vynel Display" (daemon `focus()` matches by title — both ends moved together) |
| `capabilities/default.json` (id `jarvis-window`) | `capabilities/display-dock.json` (id `display-dock-window`) |
| `--jarvis-only` | `--dock-only` |
| `apps/voice/src/overlay/jarvis-window.ts` | `display-dock-window.ts` (`createDisplayDockWindow`) |
| wire surface literal `'jarvis'` (`VoiceSurface`/`OverlaySurface`, `voice:jarvis[:wake]`, `?surface=jarvis`) | `'dock'` |
| env `VYNEL_VOICE_JARVIS_{WINDOW,URL,BROWSER,APP}` | `VYNEL_VOICE_DOCK_{WINDOW,URL,BROWSER,APP}` |

The env knobs are user-facing config, so the OLD names stay accepted for ONE release:
`applyDeprecatedVoiceEnvAliases` in `apps/voice/src/env.ts` merges them into the raw object before the Zod
schema sees it — one home rather than four per-field `preprocess` hooks — and the NEW name wins when both are
set. Drop that map and `env.test.ts` after the release.

The repo's product-level channel naming went with it: "Voice/Jarvis" → "Voice" in `CLAUDE.md`,
`README.md`, `apps/README.md`, `docs/architecture.md` and `docs/vision.md`.

**One deliberate residue, awaiting a product call:** the retired spellings in `WAKE_NAME`
(`packages/voice/src/turn-taking/wake-word.ts:25`) still let a user who says the old name be *heard*.
Dropping them is a behaviour change, not a rename, so it was left for Kafi — and `wake-word.test.ts`
now PINS that alternation ("still hears the retired name…") so nobody tidies it away by accident:
deleting the spellings means deleting that case, which makes the removal a visible decision.

## Slices

**Carried over from P2 — re-advertise the `dock` slot.** P2 shipped the slot in the schema, the contracts and
the leaf, but took `'dock'` out of the `display_add_widget` tool DESCRIPTION (a card sent somewhere nothing
renders is a card the user never sees). P3a must put it back in that sentence
(`apps/local-api/src/routes/display/index.ts`) and regenerate — otherwise the dock ships with no way for Claude
to fill it. The census test in `apps/mcp/src/generated/api-tools.test.ts` pins the current state and must flip
with it.

| | Owns | Delivers |
|---|---|---|
| **P3a dock mode** | `views/DisplayDockView.vue` (the renamed voice window view), `composables/display/use-display-dock-parking.ts`, `tauri-overlay-window.ts` (a `park: 'bottom-right'` with a stacking offset), `windows.rs` size/label, capabilities file | two parking spots: **center** on wake (today's behaviour, for the wake conversation) and **mini bottom-right** (≈ 380×140: small orb + last caption + mic pill + the `dock` slot widgets from `use-display-widgets`) whenever a voice session is live and the app's Display is NOT active; stacked ABOVE the desktop-control window when that one is visible — same rule, one home: the dock subscribes `activity` and reuses `isDesktopOverlayVisible` to pick the offset. Rule: the in-app Display active → the dock hides (the room owns the orb); the user leaves the Display mid-session → the dock reveals mini. |
| **P3b wake opens the app** | `apps/voice/src/overlay/display-dock-window.ts`, `apps/voice/src/main.ts` wake policy, `packages/contracts/src/voice/daemon-events.ts`, `use-voice-daemon-link.ts`, `AppShell.vue` | the daemon, on wake with `VYNEL_VOICE_DOCK_WINDOW=1`: opens/focuses the dock as today AND spawns the exe argless → the single-instance handler surfaces the main window; a new daemon event `{ kind: 'show-display' }` rides `voice:app` (app surfaces only, never a wake target) → `AppShell` opens the Display via `use-display-toggle`; the dock then hides (rule above) and the in-app room takes the conversation over — define the hand-over honestly: the wake session stays in the dock window's leg until it ends (no mid-turn migration of a Web Speech session across windows); the room shows the orb reacting to the daemon leg (`isDaemonSpeaking`) and its own mic stays muted until the dock session ends, then resumes. |
| **P3c orb from the daemon leg** | `display-orb-state.ts`, `DisplayView.vue`, the dock view | listening/speaking from `voice:<surface>` state frames when the conversation runs on the daemon leg; spike per relayed clause; energy from status as today. |

## P3b — the wire, as built

Two new frames on the voice channel, one route, one daemon phase. Both frames are about WINDOWS
rather than speech, and both exist because the app window and the display dock cannot see each other.

| frame | direction | carried on |
|---|---|---|
| `{ kind: 'show-display' }` | daemon → **app surfaces only** | a `VoiceDaemonEvent` (parsed by `parseVoiceDaemonEvent`, relayed like `state`) |
| `{ kind: 'display-active', active }` | app window → every `voice:*` of that user | a `VoiceControlEvent` — the API's own word, a sibling of `daemon-link`, never parsed as a daemon event |
| `{ kind: 'display-session', live, phase, caption }` | app window → every `voice:*` of that user | the second `VoiceControlEvent` — the conversation the ROOM is holding, so the dock can MIRROR a session it does not own |

- **The mirror (`display-session`).** Most conversations start in the room, not on a wake, and a Web
  Speech session cannot migrate across windows — so the app window announces its phase/caption
  (`use-display-session-announce.ts`, one home; liveness + phase immediate, caption throttled to
  ≥ 250 ms, `live: false` on end/unmount, re-announced on live-channel `status === 'open'`) via
  **`POST /voice/display-session`** (`x-sdk-name: voice.setDisplaySession`, **no `x-mcp`**), and the dock
  shows it as `mini` with `isMirror: true`: same park/stack rules, a read-only mic pill (Muted /
  Listening — the microphone stays in the app), and the dock's OWN session always winning. The hub
  memo is now per user **per kind**, and `releaseVoiceControlIfAppGone` retracts each fact that is
  still on (`active: false` / `live: false`). The mini row also gained a keyboard-reachable **×**:
  it ENDS a conversation the dock owns, and only dismisses a mirror until the next session starts.
  The caption is CLAMPED to its tail at the producer — `DISPLAY_SESSION_CAPTION_MAX_LENGTH` (280) is
  exported from contracts beside `DISPLAY_SESSION_PHASES` and the route's Zod schema reads the same
  const. The room's caption is the whole reply so far and grows without bound; un-clamped, a long
  reply was rejected by the route and the failure swallowed by the announcer's `.catch(() => {})`,
  so the dock's row froze for the rest of it. The tail is what was just said, which is what a corner
  row is for.
  `DisplayDockView` also draws **nothing** for `mode === 'hidden'` (a `v-else-if="mode === 'wake'"`,
  not a `v-else`): `hide()` is a no-op in the Chrome fallback, so falling through to the full stage
  painted a second orb beside the room's for a conversation the room already owned.

- **`POST /voice/display-active { active }`** → `{ published }` — user-scoped, `x-sdk-name:
  voice.setDisplayActive`, **no `x-mcp`** (a window talking to the user's other windows is not a
  capability the model may reach for). The route hands it to `voiceControlSink` (`apps/local-api/
  src/live/voice-control-sink.ts`, the `display-live-sink` shape) → `hub.publishVoiceControl`.
  `published: false` = no live channel on this engine.
- **Surviving a reconnect — BOTH halves, deliberately.** The hub MEMOISES the last control frame per
  user and replays it inside `attachVoice`'s `replay()` (after the relay's own), because the two
  windows connect independently: without it a dock that reconnects — or opens while the room is
  already up — would never hear a fact announced before it arrived. And the app window re-announces
  on every change (`use-display-toggle`, `immediate`) plus `onScopeDispose`. The memo is RETRACTED
  (and `active: false` broadcast) when a connection closes and the user holds no `voice:app*`
  subscription any more — never on unsubscribe, because inside the app window the voice link moves
  between `VoiceOverlay` and `DisplayView` as the Display opens, and that swap must stay invisible.
  `isAppDisplayActive` is deliberately NOT reset when a socket drops (unlike `daemonState`, which
  gates a microphone): a blip would flash the dock open and shut. Both announcers also re-announce
  on live-channel `status === 'open'` (`use-display-toggle`, `use-display-session-announce`), which
  is what closes the api-restart hole: the memo comes back empty, and the app says it over.
  **Multi-window:** the memo is per user per KIND, so with two app windows open the last one to
  announce wins that kind. That is the honest reading — the dock mirrors *a* conversation, and only
  one window holds a microphone at a time — but two rooms racing is not modelled.
- **`handed-off` is the channel's own phase, not the driver's.** The driver publishes `wake` and
  then goes silent for the whole handoff, so a dock conversation parked at `wake` for its entire
  life and no surface could tell "a wake just fired" from "the dock is holding the room".
  `overlay-channel` publishes it from `deliverWake`'s CONFIRMED write — the one moment that knows
  the room changed hands — and `endHandoff` → `setState('idle')` already clears it. Publishing it
  from the driver instead would have run while the wake was still pending and `publishState` would
  have NULLED that pending wake: the dock would connect to a session nobody handed it, `hasWakeTarget`
  would be true so the connect watchdog would never fire, and the daemon would sit handed-off to no
  one. Hence `OverlayPhase = VoiceSessionState | 'handed-off'` and the split `broadcastState`.
  It maps sensibly in `display-orb-state.ts` untouched (energy falls through to 0, `!== 'idle'`
  keeps the orb listening — exactly what `wake` did).
- **What a wake now does to the screen** lives in `apps/voice/src/overlay/wake-handoff.ts`
  (`createWakeHandoff`) instead of inline in `main.ts` — the app leg (`dockWindow.openApp()` +
  `overlay.publishShowDisplay()`) runs on EVERY wake, BEFORE the dock's already-connected `focus()`
  shortcut returns, because the dock may be resident while the app is not.
- **ONE launch per cold wake (fixed).** `openApp()` spawns the exe ARGLESS, and that single process
  builds the main window AND the `display-dock` webview (`windows.rs` `create_windows`) — so it is
  the dock's launch too. Also spawning `--dock-only` (as the first cut did) made a second process
  that lost the single-instance race, exited 0 inside the early-exit window, and read as a dead
  launch: every cold wake ended with a stray Chrome dock beside the real one. `open()` and its
  early-exit watchdog are gone with it; `DisplayDockWindow` is now `hasApp` / `openApp()` /
  `openBrowser()` / `focus()`. `--dock-only` stays a flag the desktop shell honours — it simply has
  no producer any more.
- **The connect watchdog is the only verdict.** Whether a dock came up is answered by a dock
  CONNECTING, so `wake-handoff` owns the whole ladder: argless launch (or the browser straight away
  on a machine with no desktop app) → one connect window → the browser window → a second connect
  window → `abandonHandoff()`. **Residual:** a wake into a completely broken desk leaves the daemon
  handed-off and deaf for up to 2 × `DOCK_CONNECT_TIMEOUT_MS` (20 s). Abandoning at the first fire
  would be worse — `endHandoff` publishes `idle`, which nulls the pending wake, so the browser
  window would open onto a conversation nobody could hand it.

**Hand-over honesty.** The wake session stays in the **dock window's leg until it ends**. There is no
mid-turn migration of a Web Speech session across windows — the room MIRRORS it (P3c: the orb reads
`daemonState`/`isDaemonSpeaking`) and its own microphone stays shut until the dock posts
`/session/end`, at which point the daemon returns to `idle` and the room's session takes over. So
`show-display` is a request to LOOK at the room, never to move the conversation into it.

**The gate that enforces it** is `isVoiceHeldElsewhere` in `use-display-voice` — `daemonState !== 'idle'
&& !voice.isActive` — and it holds both `start()` and the unmute branch of `toggleMute()` shut; the mic
pill reads **"Dock is listening"** meanwhile. `voice.isActive` is load-bearing, not decoration: when the
wake landed in THIS window the daemon also sits `handed-off` for the whole session, and that one is ours.
`handleWake` goes STRAIGHT to `beginSession()` for the same reason — the driver publishes `wake` before
it delivers the wake event, so a gate on the daemon's phase alone would swallow the wake it just handed
us. Two knock-ons, both correct: the title-bar switch's `start()` and DisplayView's "Voice on" pill are
no-ops while the dock holds the room (the room still OPENS — `showDisplay()` runs first, which is exactly
"a request to look"), and "Dock is listening" is imprecise for a native-daemon leg with no dock window
at all (dock off, no browser wake target) — Chad's wording call, not a second label. One accepted
transient: muting a session the daemon handed to THIS window reads "Dock is listening" for the round
trip until `/session/end` lands and the daemon publishes `idle`. Adding `&& !isMuted` would close it and
reopen a PERSISTENT hole — mute, walk away, say the wake word, and the room would offer to unmute over
the dock's conversation — so the self-correcting transient is the better trade.

**Still open (pre-existing on main, deliberately untouched):** the room's `/session/end` POST is
per-window and unscoped, so the daemon's session seam is the wider job the gate does not close.

## P3d — the voice outlives the room (2026-08-21, Kafi)

The mirror above was unreachable as built: the room owned the session (start on mount, end on unmount), so
leaving the Display hung the conversation up and the mini dock had nothing left to mirror. **The top-bar
switch is the real voice on/off now**, and the session belongs to the WINDOW:

- `composables/display/use-display-voice.ts` — one Pinia store per window (`live-turn-registry` is the
  precedent for window-lifetime machinery that needs the injected client) owning `useVoiceSession`, the daemon
  link and the mirror announcement. `start()` / `end()` / `toggleMute()`, `isLive`, and the view/orb inputs the
  room reads.
- `ownsVoice = isLive || isRoomOnScreen` is the ONE predicate for "the Display feature holds this window's
  microphone": it gates the daemon link inside the store AND `<VoiceOverlay v-if="!displayVoice.ownsVoice">` in
  the shell, so the window can never hold two links (two players, every relayed line spoken twice).
  `isRoomOnScreen` is pushed by `use-display-toggle`'s sync watcher — the toggle is the one reading of "the room
  is on screen", and the store must not depend on the toggle back.
- `start()` closes `VoiceOverlay` and opens its own recognizer in the SAME tick, so that overlay's
  `ui.isVoiceOverlayOpen` watcher is `{ flush: 'sync' }` (the idiom `use-display-toggle` and the daemon link
  already use). Queued, the order inverted — the store's recognizer opened and only then was the overlay's
  ended, leaving two Web Speech sessions in one window for a tick.
- The switch: **on** → `start()` + show the active tab's Display; **off** → `end()` from wherever you are,
  restoring the tab's previous view only if the room was what you were looking at. `showDisplay()` is a
  separate door for the wake path (`show-display` must never turn the conversation it announced off).
- `DisplayView` renders whatever the window's session is doing and starts nothing. Its mic pill gained a fourth
  honest state — **Start** — for voice off. Idle silence still ends the recognizer without ending the voice
  (Resume, and a wake still lands here).
- Dropped: `ui.displayVoiceRequestCount` / `requestDisplayVoice`. The shell reaches the session directly now.
- **Open product call for the lead:** `AppTitleBar`'s "Open/Close Display" title reads wrong in the one state
  where voice is live behind another view (the switch is lit, but the room is not on screen). Chad's label was
  left alone.

## Acceptance

- Turn the switch on, start talking, leave the Display → the conversation keeps going and the dock mirrors it
  bottom-right; come back → the same session, no restart; switch off from anywhere → it ends.
- Say the wake word with the app closed → the app opens on the Display, the dock shows the wake conversation
  (center), the room's orb mirrors it; when that session ends the room's own mic takes over.
- In the Display, start talking, switch to a workspace → the dock appears mini bottom-right with the last caption
  and the mic live; start a desktop-control task → the dock shifts up above the progress window; return to the
  Display → the dock hides.
- A voice turn that calls `display_add_widget` with `slot: 'dock'` shows that widget in the mini dock.
- No second microphone ever: at most one live Web Speech session per user across the app window and the dock.
