# 2026-07-21 — voice reliability + latency

## voice — three silent-voice failure modes closed, latency/UX round, review follow-up

**What moved/changed.** Root-caused "the root session didn't talk" from the live transcript, not
the plumbing: every wiring link was correct (`voice:true` stamped, `speak` in the routing registry,
proxy fine). The real modes were (1) a `speak` with a connected-but-*idle* overlay client was
dropped while reporting `spoken:true` — the daemon deferred to an overlay that only plays its OWN
session's stream; (2) on the long root session the model drifts back to text-only replies — the
system-prompt voice block loses to conversational momentum (the failing turns had a delegation
catch-up block prepended); (3) no safety net when the model answers in prose. Fixes: single-delivery
`speak` SSE events on the overlay channel (idle client plays; native only when nobody's connected),
`voice-turn-marker.md` restated per-message on the provider input, and the overlay speaking
`toSpokenGist` of the text answer when a turn never called `speak`. Plus: endpoint silence
5000→3000 (Chad's floor — 1800 clips think-pauses), "Thinking…" caption, glass card behind the
floating stage (reopens the no-card pick — unreadable over busy screens), sentence-pipelined
overlay playback (first sound after ONE sentence's synthesis; also stays under the /synthesize
cap), and the `speak` tool description as editable markdown (`tool-descriptions/` subpath, generated
registry byte-identical).

**What we learned.**
- Debug voice through the *persisted transcript* first — `originChannel` stamps + tool-call rows
  told the whole story (voice turns used to speak, stopped mid-history) before touching any code.
- Instruction decay is real on the one resumed root session: a per-message restatement (the
  catch-up-block pattern) beats strengthening the system prompt.
- Audio ownership is a routing decision with four parties (native driver, live overlay session,
  idle overlay client, nobody) — every pairwise assumption ("hasClient means the overlay plays it")
  was where the silence hid.
- `pause()` fires neither `onended` nor `onerror` — any awaited HTMLAudio playback needs its
  resolver reachable from `cancel()` or the awaiting loop wedges (review finding, deaf-daemon
  class).

**Gate.** `pnpm test` green at every commit (2701 tests); `code-reviewer` on the full diff: no
must-fix, two should-fix (cancel-resolve hang; echo-defense bypass when a client connects mid
native conversation — delegation now requires `!driver.isAwake`) — both fixed + tested in
`4766470`. Known limitation recorded, not patched blind: a scheduled-task `speak` firing during a
live overlay session is still dropped (needs session provenance on the speak route).
