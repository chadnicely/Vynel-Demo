# Voice realtime — the "speak as you think" arc (2026-08-19)

Kafi's brief (verbatim, 2026-08-19): *"For the voice we have to improve tts — we are missing something.
We can use realtime chunking; the voice model doesn't capture that much CPU. How voice/Jarvis should
work: interacting conversation with the user — user speaks, it stops speaking, listens → responds →
speaks as fast as possible. Also it always says 'let me check', 'one moment' — that should be the
model's first response as per task, not a static random line."* Plan approved as written (the four
points below). Branch `feature/voice-realtime` (worktree `.claude/worktrees/session-audit`, band 18940).

## Decisions (Kafi, locked)

| # | Decision |
|---|---|
| VR1 | **The voice thread speaks its own streamed TEXT.** Sentence/clause-chunked as deltas arrive; the first sentence is spoken the moment it closes; synthesis pipelined one sentence ahead. The `speak` tool is NOT attached on voice-thread turns (the thread's text IS its voice — the call leg already works this way); the tool stays for every OTHER session speaking through the daemon (typed global chat, schedules, deliveries). The voice instruction + marker are rewritten: "you are heard as you write — short spoken sentences, lead with the answer, no markdown". |
| VR2 | **Barge-in on both legs.** Overlay: recognition stays ON while speaking (browser AEC covers the browser's own playback); a real transcript CUTS playback, interrupts the running server turn (identity-shaped `interruptTurn({sessionId})`) and runs the new turn. Native daemon: port the call leg's proven post-transcription cut + spoken-line echo filter (mic open while speaking; a transcript matching a recently spoken line is an echo, anything else is the user). |
| VR3 | **No canned lines except failure / hard-limit ones.** The ack library (`pickAckForRequest`) and "One moment." go; the 5-min watchdog line stays as a rare honesty line; "Sorry — I hit a problem" stays for failures. The model's first streamed sentence IS the acknowledgment — contextual by construction. |
| VR4 | **Latency knobs:** clause-level cut (sentence punctuation, or ~120 chars at a clause break, never mid-word), overlapped synthesis, sonnet-5 / low stays (decision D2). |

## Assumptions (lead)

- The SSE already carries `text-chunk` deltas + `session-created`/`turn-updated` (the session id) — the
  clients were ignoring them. The server change is small: drop `speak` from voice-thread turns, rewrite
  the instruction, make sure every voice leg learns its session id early for the interrupt.
- A barge-in interrupts the server turn (the user moved on) — the interrupted turn's partial reply stays
  in the transcript as text; the new utterance is a new turn.
- The Voice chat panel's typed turns speak their streamed reply in the browser through the same
  sentence pipeline (browser player), not through the daemon relay.
- Echo filter = ONE shared home in `packages/voice` (extracted from `call-conversation.ts`), used by the
  call leg and the wake leg.
- The overlay's Web Speech recognizer: keep it running while speaking; browsers apply AEC to their own
  output — verify `echoCancellation: true` where `getUserMedia` is ours; if Web Speech exposes no knob,
  rely on the echo filter too (belt + braces).

## Slices + ownership (one worktree, disjoint paths, agents do NOT commit — the lead commits per slice)

| Slice | Model | Owns | Delivers |
|---|---|---|---|
| **VR-A server** | opus | `apps/local-api/src/streams/global-root-turn.ts` (voice leg only), `apps/local-api/src/streams/session-turn.ts` (voice leg only), `apps/local-api/src/sessions/{compose-session-mcp-servers,session-tool-catalog}.ts` (only if the speak tool is composed there), `packages/instructions/session-instructions/{voice-turn,voice-turn-marker}.md`, `apps/local-api/src/routes/voice/**` (speak route unchanged unless needed), tests | A1 voice-thread turns (wake, overlay, typed panel, call) get NO `speak` tool (deny/omit at composition) — every other surface keeps it. A2 instruction + marker rewritten for text-as-voice (short spoken sentences, lead with the answer, no markdown, no "let me check" filler — say what you are doing only when the work takes long, in your own words). A3 the voice leg's stream yields the session id as early as today (`session-created` / `turn-updated`) — verify; document the interrupt contract for clients (`POST /root/turn/interrupt {sessionId}`). A4 tests: voice turns carry no speak tool; non-voice still do; instruction snapshot. |
| **VR-B daemon + voice package** | fable | `apps/voice/src/**`, `packages/voice/src/**`, tests | B1 NEW `packages/voice/src/turn-taking/spoken-echo-filter.ts` (extracted from `call-conversation.ts`'s `#recentSpokenLines` / `ECHO_*` logic; call leg re-pointed, behaviour-neutral, tests moved). B2 wake leg speaks STREAMED TEXT: `run-brain-turn.ts` maps `text-chunk` → `text` events (already?) and the driver feeds them through `SpokenSentenceBuffer` (clause-level cut, VR4) → `LineSpeaker` pipelined; the `speak`-tool relay path stays for OTHER producers (`onSpeak`). B3 barge-in on the native leg: mic stays open while speaking; each transcript runs the echo filter; a real utterance → `cutPlayback` + interrupt the server turn (`POST /root/turn/interrupt {sessionId}` via the brain client; the daemon learns the id from `session-created`/`turn-updated` frames) + run the new turn; state machine updated (no more 'busy drops mic'). B4 canned lines: remove "One moment." (turn-queued → silent + log), keep the watchdog line + the failure line; delete `ack-library.ts` + tests (VR-C removes its consumer). B5 call leg: clause-level buffer + pipelining too; late-reply queueing (R2-F) if cheap. Tests: sentence buffer (clause cut), echo filter (ported cases), driver (speaks first sentence before the stream ends; barge-in cuts + interrupts + starts the new turn; echo does not cut), brain client (interrupt). |
| **VR-C web overlay + panel** | fable | `apps/local-web/src/composables/voice/**`, `apps/local-web/src/components/voice/**`, `apps/local-web/src/views/JarvisView.vue`, `apps/local-web/src/components/chat/VoiceChatPanel.vue`, tests | C1 `voice-turn-adapter.ts`: yields `spoke` per SENTENCE from `text-chunk` deltas through the shared `SpokenSentenceBuffer` (import from `@vynel/voice`), still yields speak-tool `spoke` for other producers' relays; the gist fallback only when nothing was spoken. C2 `voice-command-session.ts`: remove the ack (`pickAckForRequest`); play sentences pipelined as they arrive (the player's queue); keep the mic recognizer RUNNING while speaking; a real final transcript while speaking → cancel playback + `interruptTurn({ sessionId })` (learned from `session-created`/`turn-updated`) + run it as the next turn; echo guard: ignore transcripts that match a recently spoken line (shared filter) as belt + braces. C3 `use-voice-session.ts` / `VoiceOverlay.vue` / `JarvisView.vue`: view states allow listening-while-speaking; orb/transcript shows partial spoken text as it streams. C4 VoiceChatPanel: typed turns play the streamed reply per sentence in the browser (same player); Stop renders for a watched voice turn. Tests: adapter (sentence streaming, no double speak), command session (no ack, barge-in cut + interrupt + new turn, echo ignored), panel. |

Rules: house rules (CLAUDE.md); every change ships tests; targeted vitest/tsc only (never `pnpm test` — the lead runs the gate); no commits (the lead commits); `git status` shows only your owned paths when you hand back; a ≤ 40-line hand-back (what changed, tests, verification, asks). Cross-slice contract: `SpokenSentenceBuffer` (packages/voice) is the ONE chunker for daemon + web + call; the interrupt is `POST /root/turn/interrupt { sessionId }`; voice-thread SSE carries `text-chunk` + `session-created`/`turn-updated`.

## Acceptance

- Wake: first spoken audio ≤ the model's first sentence close (no ack, no speak-tool round-trip); speech keeps up with generation (pipelined); no double speech.
- Barge-in: speaking → the user talks → playback cut within ~300 ms, server turn interrupted, the new utterance answered; the daemon's own voice never triggers it (echo filter); the overlay's own playback never triggers it (AEC + filter).
- No "let me check" / "one moment" / keyword acks anywhere; failure + watchdog lines only.
- Typed Voice-chat turn: spoken per sentence in the browser; Stop works.
- Call leg unchanged in behaviour except faster chunking + late-reply queueing.

## Live smokes (Kafi, after the desktop rebuild + overlay rebake)

wake → answer starts speaking mid-generation · interrupt it mid-sentence by speaking → it stops, answers the new question · a long task: the model's own "I'll check your schedules" line (not a canned one) · the daemon leg with the Jarvis window off (native barge-in + echo filter: speaker near the mic) · typed panel turn speaks · a live call keeps working · watchdog still fires at 5 min.

## Results

_(filled at integration)_
