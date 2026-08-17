# A RECOVERABLE turn error paints the conversation red until the next turn

**Status:** open
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
