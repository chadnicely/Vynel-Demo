# Checkpoint survivor (audit r2 · R2-H + R2-N + R2-O)

A SURVIVOR is a pending checkpoint written before this process started: the app died between
`checkpoint()` and its continuation. Today it waits invisibly, is silently overwritten by the next
`checkpoint()`, never resolves on the voice thread, and its handed-over slot leaks when the follow-up
job settles by anything but its own claim. Kafi (2026-08-20): **surface on boot, never auto-run**.

1. **Boot surfacing** — `surfaceCheckpointSurvivors` (`@vynel/session/continuity`), called from
   `boot.ts` with the other reaps, BEFORE any service can start a turn. Each live primary holding a
   PENDING slot gets a system note on its head (`recordSystemNoteMessage`, the dropped-checkpoint
   precedent), worded neutrally (the delegated rail drops a leftover on its next genuine job, so the
   note may promise nothing) and idempotent — skipped when the head's newest row already IS that
   note. VOICE primaries are DROPPED instead (new reason `restarted`): that thread never continues.
2. **`whoami`** — `WhoamiReport.pendingCheckpoint`, so a session learns it still owes a step.
3. **Next-turn marker** — provider-input only (voice-turn-marker precedent) at the two compose homes
   that own a continuing identity's genuine turn: `startChatTurn`, gated on the new
   `continuity.autoContinues` (set by the workspace + spawned streams — a schedule fire passes
   `continuity` for the swap but runs its own turn, so it must NOT promise a pick-up), and
   `composeGlobalRootProviderMessage`, gated on `autoContinue !== false` && not a continuation.
   Injected once by construction — a continuation's slot is already taken. It says what actually
   happens: Vynel picks that step up right after this turn, so do not redo it here.
4. **Overwrite = supersession** — the `checkpoint` tool drops a SURVIVOR first (`superseded` + its
   note); a same-life re-checkpoint stays silent (boundary: injected `survivorBefore`, default the
   process start).
5. **The leak** — `reconcileContinuationJobs` drops any handed-over slot whose follow-up job is
   TERMINAL or gone; it rides `settleOrphanedDelegationClaims` (boot + the 60 s lease sweep), and
   the delegation Stop route drops its slot immediately.
6. **R2-N** — the checkpoint tool's description, its answer, and `SESSION_PROMPT_INSTRUCTIONS` stop
   promising an automatic continuation everywhere. No other prompt/notebook repeats the promise.
7. **R2-O** — the native voice leg speaks an honest line when a turn ends having said nothing. The
   audit's "the overlay leg has a net" is stale: post voice-realtime both legs read streamed text
   and share the hole (overlay recorded as a follow-up, not fixed here).
