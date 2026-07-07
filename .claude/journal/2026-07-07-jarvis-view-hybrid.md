# 2026-07-07 — the hybrid Jarvis view (daemon wake → browser command session)

## What moved
Not a pull — a net-new build completing the voice feature per Chad's direction: "use small model to
wake up, then use Google STT to get the most accurate voice recognition with the Jarvis overlay —
complete speak as well."

- **Daemon** (`apps/voice`): `VoiceSessionDriver` gained a `'handed-off'` state + an injected
  `WakeHandoff` seam; new `overlay/overlay-channel.ts` — a loopback Hono server (port 8997) with
  `GET /events` (SSE: state replay + wake/state events + heartbeat) and `POST /session/end`.
- **Web** (`apps/local-web`): `composables/voice/` — a Web Speech recognition wrapper (local ambient
  types; lib.dom has none), a `speechSynthesis` sentence speaker, the unit-tested
  `voice-command-session` machine (mirrors the daemon driver's shape in browser idioms), the
  `use-voice-session` binding (chat-turn SSE → voice events adapter), `use-voice-daemon-link`
  (EventSource + session-end). `VoiceOverlay.vue` replaced `VoiceOverlayDemo.vue` — the last "demo"
  surface in the app is gone. Vite gained a `/voice` proxy.

## Fork resolutions (were open in STATE.md)
1. **Signaling**: daemon-hosted SSE + plain POST, reached via a Vite proxy. NOT WebSockets — events
   flow one way and the return path is a single POST, so `@hono/node-ws` stays retired.
2. **After wake**: the browser owns the whole active session (STT + turn + speak). The daemon goes
   deaf while handed off — which doubles as the cross-process echo defense (it can't hear the
   browser's TTS or re-wake on the reply mentioning "Vynel").
3. **Daemon fallback**: kept whole. Zero overlay clients → the native Moonshine+Kokoro loop runs
   exactly as before.
4. **Speak**: browser `speechSynthesis` through the shared `SpokenSentenceBuffer` (same
   sentence-pipelining as the daemon). Kokoro-streamed browser audio is a later improve behind the
   same `SentenceSpeaker` interface.

## Learnings
- **The handoff seam is tiny because the driver was already a headless injected state machine** —
  one new state + a two-method interface; every prior test kept passing untouched. The "everything
  injected" discipline paid for itself again.
- **Web Speech endpointing does the VAD's job in the browser**: a non-continuous recognition
  finalizes on a natural pause, so the browser session needs no VAD at all. Silence accumulates
  across capture attempts against one idle deadline (a single capture gives up after only a few
  quiet seconds — shorter than the 15 s window).
- **happy-dom has no `EventSource`** — the app-shell test mounts the real overlay now, so the daemon
  link guards `typeof EventSource === "undefined"` (also the right graceful-degradation for exotic
  webviews).
- **Fake-timer + scripted-promise deadlock**: a session test whose fake captures resolve in
  microtasks never advances `Date.now()`, so an idle-deadline loop can consume the script inside the
  window and then hang on the "quiet room" capture. Give scripted captures a `setTimeout` delay so
  `advanceTimersByTimeAsync` moves the clock through the scenario.
- Pre-existing, out of scope: `apps/voice` isn't wired into the repo lint task (`main.ts` trips
  `prefer-const` on the late-bound driver + an unresolvable `n/no-process-exit` disable comment).

## Review round (code-reviewer: "approve after #1" — all findings applied)
The reviewer surfaced a **"stuck handed-off" failure family** worth remembering: every path where the
browser claims a wake but never runs a session leaves the daemon deaf machine-wide, because only a
session's end posts `/session/end`.
1. **Must-fix:** a Web-Speech-less browser (Firefox subscribes to SSE fine!) failed `start()`
   silently → now a failed start still fires `onEnded` (tested via happy-dom, which has no Web
   Speech), and the overlay stays open when there's a failure caption to read.
2. A wake published mid-EventSource-reconnect was lost with no `onClientsGone` (the new subscriber
   already exists) → the daemon's state replay is the recovery hook: the link treats a REPLAYED
   `state:'wake'` (first event after every onopen) as a bare wake.
3. SSE heartbeat interval leaked if the client aborted during the replay write → created only if the
   subscriber survived the replay, cleared after `closed`.
4. Offline Chrome fails captures instantly ('network') → a 500 ms silent-capture floor stops the
   session loop hot-spinning new recognitions.

## Same-day revision — the FLOATING window (Chad's smoke feedback)
Chad's first live try: STT/speak/orb all worked from the mic button, but he expected v1's GLOBAL
overlay, not a view inside the tab. The platform fork that decided it: **Web Speech doesn't exist in
Tauri's WebView2 or Electron** — a native always-on-top overlay would forfeit Google STT. Chose a
**chromeless Chrome app-window** the daemon opens/foregrounds on wake (AskUserQuestion; Chad picked it
over Tauri-with-Moonshine and keep-in-tab).
- `/jarvis` bare route (`meta.bare` — App.vue skips the shell AND the in-app overlay, one daemon link
  per window) + shared `VoiceStage.vue`/`voice-stage-view.ts` so the two surfaces can't drift.
- Channel: `?surface=` tagging, wake delivered ONLY to the newest jarvis client when the window mode is
  on (tabs never race it), **pendingWake held-until-confirmed + replayed on connect** — the same-breath
  command survives the ~1 s launch; this SUPERSEDED the browser-side replayed-state hack from the
  review round (server-side, command preserved). `onClientsGone` = "the wake RUNNER left".
- Daemon: `jarvis-window.ts` — Windows launch via `cmd /c start ""` (browsers resolve via App Paths,
  not PATH), focus via PowerShell `AppActivate` on the title JarvisView sets; a 10 s connect watchdog
  ends the handoff if a launched window never connects.
- **Learning: Vite may bind IPv6-only** (`[::1]:8999`): IPv4 `127.0.0.1` probes report the port dead
  while Chrome's `localhost` works. Diagnose with `netstat`; default the jarvis URL to `localhost`.

## Same-day probe — the Tauri assumption was WRONG (and cheap to test)
Chad pushed back on "Web Speech doesn't exist in WebView2" and asked to experiment. A ~50-line wry app
(scratchpad `stt-probe/`, 48 s first build — Rust was already on the box) + a probe page + a log server
settled it in minutes, live: **WebView2 149 ships a working, standard-named `SpeechRecognition`** —
mic granted, word-by-word interims, punctuated finals (Azure-backed), `speechSynthesis` speaks
(voices-list async quirk same as Chrome). **The true always-on-top Tauri overlay is unblocked and hosts
the existing browser session as-is.** Lessons: (1) capability blockers deserve a live probe before they
shape architecture — this one was stale training-data knowledge and cost a design detour; (2) a
scratchpad wry app is a ~1-minute tool for "does the webview support X" questions; (3) Windows reserves
port ranges (8123 EACCES) — pick high ports for throwaway servers.

## Verification
Gate green **1939/4-skip** (+21 total this feature). Daemon boot-smoke on the real box: models load,
channel answers on 8997, `/events` replays state, client counts tracked. Window-launch smoke: the real
`start chrome --app` command opened the window, it connected as `surface:jarvis`, daemon logged it.
WebView2 probe: recognition + TTS verified live (Chad spoke, Azure transcribed). Chad's voice smoke
("Hey Vynel" end-to-end) is the remaining gate.
