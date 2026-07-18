# 2026-07-19 — The chat-control round (queue · stop · agents parity · modes · SDK bump)

Chad's four asks after confirming the realtime fixes: ① does a workspace load Claude content
like real Claude Code (+ can the SDK move to latest) ② queue messages while Claude works +
agents parity across chats ③ a way to STOP running work, especially delegations ④ do the
session modes actually work. Three recon subagents mapped the ground in parallel; everything
landed in one gate-green slice.

## Audit results worth remembering

- **Content loading was already right.** `settingSources: ['user','project','local']` + the
  claude_code preset system prompt — CLAUDE.md, `.claude/skills`, `.claude/agents`,
  `.claude/rules`, settings.json all load for workspace turns. The global root gets user-level
  only (hidden empty cwd — by design). **Invariant:** the agent disk-mirror's
  remove-on-disable is load-bearing *because* settingSources loads `.claude/agents`.
- **Modes were never broken — persistence was.** Every forwarding hop checked out
  (ask→default, auto→auto, bypass→bypassPermissions; delegations inherit via header;
  background turns deliberately bypass with the floor still carding). The report that "modes
  don't work" traced to `composerMode` resetting to 'ask' on every reload. Lesson: when a
  verified-working system "doesn't work", look for state that doesn't survive the user's
  actual usage pattern (Chad was reloading constantly because of the realtime bug).
- **The scariest stop finding:** an interrupted delegated turn used to drain "cleanly" — green
  job + the partial text pushed as a real report. Interrupt-the-provider was necessary but
  NOT sufficient; the tick had to learn what an interrupt means.

## Design calls

- **Queue busy = `view !== null`, not `isStreaming`** — status flips off at session-completed
  while startTurn is still settling; draining on the early flip races the old turn's
  `view = null` against the new turn's fresh view. And the queue PARKS on interrupt/error
  (reviewer should-fix): Stop must not auto-restart work; an outage must not burn the queue.
- **Stop wins at terminal time** (reviewer must-fix): a cancel-requested job that outran its
  interrupt (the flag-only window before a session id exists) still fails 'stopped by the
  user' with the report suppressed — the route already told the user 'stopping'; completing
  green afterwards is a lie. Coherent policy over an undetectable race.
- **The cancel bridge is an in-memory registry keyed by partialSessionId** (the correlation
  key every delegation surface already carries), living beside the trace broadcaster. The
  interactive interrupt already reached delegated turns (same provider registry) — the
  missing pieces were a surface to invoke it and tick-side meaning.
- **Agents parity was a type-widening, not a build** — the kernel query already supported
  null-workspace (user-scope-only); the SDK's allowedTools is a skip-prompt list, not an
  availability gate, so the brain's empty native allowlist never blocked the Task tool.

## SDK bump (0.3.197 → 0.3.213)

Sixteen releases, two type breaks, both in test land: canUseTool options gained required
`requestId`; CanUseTool's result went nullable. Production code untouched. The real risk is
behavioral (the bundled CLI does the filesystem loading) — Chad's live smoke is the actual
validation, not the typecheck.

## Verification

Gate GREEN 502f/2624t (from 500/2605). Reviewer: 1 must-fix + 2 should-fixes, all folded
(+ the flag-only stop test and the parked-queue test); nits recorded (queued chips are
view-local; a timed-out job's detached turn still has no stop lever — pre-existing doctrine).
