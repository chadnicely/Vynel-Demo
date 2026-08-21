# Voice routing — speak relay by owner, wake only to a capable client, overlay watchdog (2026-08-19)

Kafi's go after the voice-realtime arc: close the three daemon ↔ browser handoff seams left open by round 2
of the session audit (`docs/audits/session-2026-08-19-r2/README.md`: R2-D, R2-G) plus the bug found in
today's smokes. Branch `feature/voice-routing` (worktree `.claude/worktrees/voice-routing`, band 18950).

## The three seams

| # | Today | Fix |
|---|---|---|
| **R2-D** speak relay | `publishSpeak` targets the NEWEST subscriber of any surface; the dock window drops EVERY relayed line while its session is active (`isPlayingOwnTurn = voice.isActive`). The guard stopped the voice thread double-playing its own `speak` lines — and the voice thread can no longer call `speak` at all (VR-A), so the guard is now pure harm: a schedule's line vanishes in the window and plays in a background tab. | The relayed `speak` event carries the PRODUCING chat session id (`/voice/speak` reads the ambient `x-vynel-turn-session` header → daemon `/speak { text, sessionId }` → overlay `{ kind: 'speak', text, sessionId }`); the daemon routes to the handoff OWNER first (the subscriber that took the wake and still holds the session), else newest; the client drops a relayed line only when `sessionId` equals its OWN live turn's session (i.e. never, today — but correct by construction). |
| **wake-capable** (today's bug) | `shouldHandOff = dockEnabled \|\| overlay.hasClient` — ANY subscriber (the Tauri main window, connected for state events + the mic button) takes the wake with the window off, so the in-app overlay swallows it and nothing audible happens. | A client declares wake capability at subscribe (`?surface=dock\|app&wake=1\|0`: a HOST declaration — the dock always 1; a browser tab 1 only with Web Speech; the desktop shell's app window always 0, WebView2's Web Speech notwithstanding); `findWakeTarget` requires it; `shouldHandOff` uses `hasWakeTarget`; with the window off the daemon's wake surface is `app` (the shell's hidden dock webview is connected regardless and must not take it). No capable client → the native leg answers. |
| **R2-G** overlay watchdog | The 5-min honesty line is armed only on the native `#runTurn`; the browser leg (every wake with the window on) has no bound. | The `wake` event carries `turnWatchdogMs` (the daemon's knob, one home); the command session arms it per turn — fires once, only if nothing has been spoken yet, speaks the line through the player, the turn keeps streaming and the late answer is spoken when it lands (barge-in still cuts). Manual mic sessions use the same default. |

## Ownership (one worktree, disjoint paths, agents do NOT commit — the lead commits per slice)

- **daemon + api (fable):** `apps/voice/src/**`, `apps/local-api/src/routes/voice/{index,speak-through-daemon}.ts` (+ tests). D1 subscribe `wake` flag + `findWakeTarget` requires it · D2 `main.ts` `shouldHandOff` → `hasWakeTarget` · D3 `/speak { sessionId }` → `onSpeak(text, sessionId)` → `publishSpeak(text, sessionId)` routed to the handoff owner (tracked from `deliverWake`, cleared on session end / disconnect) else newest; event carries `sessionId` · D4 `wake` event carries `turnWatchdogMs` · D5 the api speak route forwards the producing session id (`parseTurnSessionHeader(c.req.header(TURN_SESSION_HEADER))`).
- **web (fable):** `apps/local-web/src/composables/voice/**`, `components/voice/**`, `views/DisplayDockView.vue`. W1 declare wake capability on the live-channel key (`voice:<surface>:wake`; the api relay turns it into `?surface=<s>&wake=1|0` on its daemon upstream, keyed by (surface, wake)) + the contracts parser carries the two new fields through · W2 the drop guard becomes an own-session match (the command session exposes its live session id) · W3 the overlay-leg watchdog from `turnWatchdogMs` (default = the daemon default when the session had no wake).

Wire contract (the only cross-agent surface): browser → api live key `voice:<surface>[:wake]`; api relay → daemon subscribe query `surface` + `wake`, ONE upstream per (surface, wake), speak delivered to ONE window (the last wake target while subscribed, else newest); SSE `wake` = `{ kind, command, turnWatchdogMs }`; SSE `speak` = `{ kind, text, sessionId: string | null }`; daemon `POST /speak` body `{ text, sessionId?: string | null }`.

## Acceptance

- Window off + desktop app open → wake answered natively (the shell's windows never declare wake capability; a plain browser tab with Web Speech still takes it). Window on → unchanged.
- A schedule's `speak` during a dock conversation plays in the display dock once, nowhere else.
- A browser-leg turn that produces nothing for the watchdog window says the honesty line once and still speaks the answer when it lands.
