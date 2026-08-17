# A RECOVERABLE turn error paints the conversation red until the next turn

**Status:** FIXED 2026-08-17 — see [Resolution](#resolution) at the bottom.
**Kind:** latent-defect
**Area:** `packages/chat` (turn consumption) + `packages/contracts` (session status ladder)
**Opened:** 2026-08-17 (raised by the code review of the session-status arc; accepted as-is to ship,
recorded here rather than left in a commit message)

## Symptom

The provider distinguishes recoverable failures from terminal ones — `session-errored` carries
`isRecoverable`, and a `provider_start_timeout` (for example) is explicitly recoverable
(`run-claude-chat-session.ts`). The turn envelope respects that: only `!isRecoverable` marks a turn
`failed` (every stream does this the same way).

The per-conversation status ladder does not. `findSessionStatusMessageFacts` keys purely off
`chat_messages.errorMessage !== null`, and `consume-session-event-stream.ts` stamps that column for
ANY `session-errored`, recoverable or not. So a transient hiccup the provider expected to survive
can leave a conversation showing **problem** (red, with the error text as its note) until a later
assistant message succeeds.

## Why it was accepted for now

The ladder's rule is deliberately "the last thing that happened errored", which is honest and
self-clearing: the next successful reply removes it, and no state is stuck. Nothing lies
permanently. It is only *coarser* than the taxonomy the rest of the pipeline now uses — the review
called it "defensible, just silently asymmetric", which is the right reading.

The reason it is worth recording anyway: the asymmetry is invisible at the call site. Someone
adding a new recoverable error class will reasonably assume the `isRecoverable` flag is respected
end to end, because it is everywhere else.

## The fix, when we take it

Persist the distinction so the read can honour it. `chat_messages` already carries `errorCode`;
either

- stamp recoverable failures with a distinguishable code (and have the facts read ignore that
  class), or
- add a nullable `errorIsRecoverable` column and let `findSessionStatusMessageFacts` filter on it.

Prefer the second if the code space is ever user-facing — overloading `errorCode` with a severity
signal is the kind of thing that reads fine for a year and then breaks a filter.

Do NOT "fix" it by dropping the error row for recoverable failures: the row is what explains an
unanswered message after a reload (`persist-turn-failure-row.ts` exists precisely because a
zero-output turn used to persist nothing).

## Reproduce

Not reproducible by hand today without forcing a provider timeout. Unit-level: emit
`session-errored` with `isRecoverable: true` through `consumeSessionEventStream`, then read
`findSessionStatusMessageFacts` — `lastAssistantError` comes back populated, and
`deriveSessionStatus` returns `problem`.

---

## Resolution

Fixed 2026-08-17, the second of the two options the file listed: a nullable
`chat_messages.error_is_recoverable` column (migration
`0045_chat_message_error_recoverable`, drizzle-generated). Overloading
`errorCode` was rejected for the reason recorded above — a severity signal
smuggled into an identity field reads fine until someone filters on it.

Null means "no severity recorded", which covers every historical row and every
row that never errored, and reads as TERMINAL — so prior behaviour is preserved
exactly where we have no better information.

### Where it is written and read

- `consume-session-event-stream.ts` — both error write paths carry
  `event.isRecoverable`: marking an already-open assistant row, and
  `persistTurnFailureRow` for a zero-output turn (whose `isRecoverable` is now
  a required argument, so a future caller cannot forget it).
- `findSessionStatusMessageFacts` — the latest assistant row counts as an error
  only when `errorIsRecoverable !== true`.

The read SKIPS a recoverable row rather than looking past it. "The last thing
that happened" stays the rule: a recoverable last thing is simply not a
problem, and must not resurrect an older terminal error underneath it. Pinned
by its own test.

### The sweep found no second instance

Three delegation runners and `fire-schedule` also capture `session-errored`
and treat it as failure without consulting `isRecoverable`. That is CORRECT,
not the same bug: in `run-claude-chat-session.ts` every `isRecoverable: true`
emission is followed by `return` — the stream ends — so a recoverable error
still means the turn produced nothing usable and the job genuinely failed.
"Recoverable" scopes the retry, it does not mean the stream continues.

Only one recoverable code exists today (`provider_start_timeout`); the
provider's own comment notes the full taxonomy is deferred. The column is the
shape that taxonomy will need, and it is now the thing readers key on rather
than the mere presence of text.
