# Voice session — the spoken twin thread (2026-08-19)

**Kafi's directive:** voice works "like the global session but a different area, same feature":
its own continuing thread above all workspaces, full global toolset (routing included — and it
can message global), `claude-sonnet-5` + LOW effort so it speaks back fast. Hidden from the UI
for now; later a "Voice chat" menu can appear under the Global area. Built in worktree
`feature/voice-session`. Background: the 2026-08-19 incident — voice turns ran ON the global
primary, so a 443k global (legit on 1M models) hard-failed every haiku-pinned voice turn.

## What already existed ("voice-jarvis piece 1")

`primary_sessions.scope 'voice'` + `uniq_primary_sessions_voice_user` liveness index ·
`getOrCreateContinuingSession({scope:'voice'})` · `findVoicePrimarySessionForUser` ·
`describeContinuingIdentity` voice case · duty book maps `voice → duty-global-root`.
The identity layer was built; nothing ever resolved a TURN onto it.

## The design (one knob: `input.voice`)

- **Turn path:** `streamGlobalRootTurn` branches its conversation target on `voice:true` —
  `resolveVoiceConversationTarget` (sibling of the global resolver; same hidden user-data cwd,
  scope 'voice'). The SAME stream function otherwise: identical toolset (routing, notebook,
  session, ask, desktop, ssh), settings no-read/no-write for voice, fit clamp, mode header.
- **Core (`runGlobalRootTurnCore`):** derives from `input.voice` — (1) lock key `${userId}:voice`
  (own single-writer domain; a long global turn no longer blocks speech and vice versa),
  (2) `newSessionOptions` title 'Voice conversation' + `scope: 'voice'` (hidden, no auto-title),
  (3) SKIPS the root catch-up block (`composeGlobalRootProviderMessage`): the collector is
  user-wide and marks reports surfaced exactly-once — a voice turn absorbing them would steal
  them from the global chat. Reports stay addressed to global (below).
- **Chat scope:** `ChatSessionScope` + contracts entry union + sessions-route z.enum gain
  `'voice'` (the both-zod-homes lesson); SDK regenerated. `isSessionInScope` matches no existing
  scope view → the thread is invisible everywhere until a Voice-chat menu ships a filter.
  Swap segments inherit scope from their predecessor (existing rule) → continuity free.
- **Daemon pins:** `VOICE_MODEL = 'claude-sonnet-5'` + `thinkingEffort: 'low'` on both turn
  bodies (wake line + call client). Sonnet-5 is 1M — the window-crash class dissolves; the
  fit clamp stays as generic insurance.
- **Comms:** slice 3 adds `send_message to:"global"` (kind note — plain communication delivered
  to the global primary, session-comms note shape) so voice can hand global a thought.

## Review round (code-reviewer, 2026-08-19) — must-fix CLOSED

The spoken thread had stepped OUT from behind the Chad-locked cross-session wall (2026-08-10):
the search fence (`chat-search.ts`), the detail read (`GET /sessions/:id/messages`), and the
identity lift (`isTurnFromGlobalRoot`) all knew only scope 'global'. Closed as ONE vocabulary:
both fences wall 'voice' beside 'global', and the lift accepts BOTH scopes — one assistant,
two areas, each may read both (a fresh voice swap segment must read its own predecessor per its
duty book). Pinned in chat-search / get-chat-session-detail / routes-sessions tests. Also from the
round: root-turn-lock renamed to lockKey vocabulary (two single-writer domains).

## Deliberate v1 residuals

- A voice-fired TASK still parents on the GLOBAL conversation (`resolveTaskSender` resolves the
  null-workspace creator = the global primary) and its report lands in the global chat — per
  Kafi the voice area "shows on global one under chat", so global holding the work ledger is
  coherent. Voice-parented tasking (sender = the voice conversation) is a later re-plumb.
  Edge: routing from voice 400s until the global thread has spoken once (no
  currentSdkSessionId) — same error message, rare, acceptable.
- Channels/delivery turns stay on the global primary (nothing targets voice).
- ⚠ KAFI QUESTION (reviewer catch): `direct_to_user` answers are absorbed ONLY by the global
  catch-up net — a VOICE-ONLY user (never opens the app) would not hear them. Options later:
  voice-thread absorption of direct rows, or a spoken notification. Named, not built.
- Per-call spawned sessions (calls arc) unchanged this arc — they keep their own shape; giving
  THEM routing tools is the later leg recorded in the voice-session-sonnet-directive memory.
- Activity feed keeps `scopeKind 'global'` + origin 'voice' — the Global node's live dot still
  covers speech (the voice area lives under Global).

## Slices — ALL THREE BUILT 2026-08-19 (this worktree)

1. ✅ Voice thread vertical: scope 'voice' in the three homes + resolveVoiceConversationTarget +
   the core knob (lock key / presentation / catch-up skip) + stream branch + SDK regen; tests in
   run-global-root-turn-core.test.ts (voice describe), compose-global-root-provider-message.test.ts,
   sessions-overview.test.ts, routes/root (thread-split spec).
2. ✅ Pins: VOICE_MODEL claude-sonnet-5 + VOICE_THINKING_EFFORT low — daemon wake line, call
   client, AND the web overlay leg (use-voice-session.ts).
3. ✅ `to:"global"` (notes only): parse + zod `to` pattern + note-only guard + tool description;
   dispatch-note grew the global target + the VOICE sender (ambient turn-session header, scope
   'voice' → signed "Voice"); enqueue target {kind:'global-root'} = both-null 'note' row;
   claim gate holds it under the GLOBAL single-writer key; the delivery runner delivers it under
   NOTE steer, body verbatim (marker composed once, at enqueue). Tests:
   run-report-delivery-tick.note.test.ts + the routing describe (task→400, self-note→400, voice
   sender end-to-end).

## Voice chat menu — SHIPPED 2026-08-19 (same worktree)

Kafi: "Add Voice Chat menu after the chat menu." Built as: sidebar row 'Voice chat'
(PhMicrophone) between Chat and Sessions, GLOBAL scope only (AppShell surfaceItems);
mainView 'voice-chat' renders VoiceChatPanel on the Global canvas (GlobalChatView branch).
The panel reads through two NEW owner-scoped UI DOORS — GET /root/voice-chat/continuing +
/root/voice-chat/transcript (root.getVoiceContinuing/getVoiceTranscript; NO x-mcp — the tool
wall stays up; transcript = resolveSessionChainTranscript from the voice head) — watches the
head segment live (useWatchedTurn; polls while a voice-origin global turn runs), and its
composer sends REAL voice turns (useChatTurn gained 'voice: true' — typed messages run on
the spoken twin under the speak steering; replies speak aloud when the daemon is up). The
composer chips read/patch the voice row's settings and sends carry them (the server honors
raw input for voice; never persisted by the turn — the no-write rule stands).

Live smokes remaining (Kafi): wake → speak on the NEW thread (fresh, fast); global chat unaffected
mid-speech; a voice 'tell global…' send landing in the global chat as a [Note from Voice] card;
the Voice chat menu: transcript renders, a wake-word turn streams in live, a typed message
answers (and speaks when the daemon runs).
