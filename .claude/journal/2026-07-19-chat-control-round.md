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

---

# Round 2 (same day) — the agent-activity trace

Chad spawned an agent from a delegated workspace turn and got a blank "Agent · 15ms" card while
the agent's tool calls flooded the thread as the manager's own work. Three compounding causes:

1. **`forwardSubagentText` defaults false** — a subagent's text never leaves the CLI. Tool
   events DO arrive by default, but unmarked-by-Vynel: the translator never read
   `parent_tool_use_id`, so they merged into the main transcript.
2. **SDK 0.3.2xx backgrounds agents by default** (`run_in_background: true`); the "15ms" was
   the async-launch ack, and Vynel's one-shot turn teardown kills a background agent when the
   main reply ends. The PreToolUse backstop now rewrites Agent/Task spawns synchronous — spawn
   policy composed with (never shadowing) the approval floor.
3. **No nested rendering existed.** Now: marked events divert into three live-only wire kinds,
   fold into `agentActivity` keyed by the spawning call's toolUseId, and render as
   `AgentActivityPane` nested under the Agent card (status-lit tool rows + streaming
   narrative). Nothing persists — settled truth is the card's toolOutput, which is the real
   report now that agents run synchronously.

Learnings: an SDK minor can flip a lifecycle default (background agents) that silently breaks a
host's process model — the bump itself typechecked clean; only a user's screenshot surfaced it.
And a subagent's `usage` would have overwritten the main session's context-occupancy under the
keep-the-last rule — found only because the recon read the translator with the question "what
else rides these messages?".

Gate GREEN 503f/2636t. Reviewer APPROVE (2 hardening should-fixes folded: floor-composition in
the hook; subagent message_start guard). Smoke items: spawn under `auto` mode (possible
classifier-interaction via updatedInput), settled card body shape. Recorded: the Watch panel
ignores agent-* events by design — a delegated turn's spawned agents trace in the workspace
thread, not the panel.

## 19h — agent activity persists (after-complete parity with the task trace)

Chad's pressure-check of 19d–19g: "the task trace can be monitored realtime even after complete —
agent activity needs the same, one global component." The audit split the claim in two: realtime +
shared-component were real (one `AgentActivityPane`, same wire events, three surfaces); the
after-complete half was not — agent activity was live-only by explicit design, so settle/reload
dropped the pane while the task trace (persisted rows) stayed watchable forever.

The fix followed the trace's own doctrine — persist as it streams, read anytime: the spawning
Agent call's `chat_tool_calls` row grew `subagentNarrative` (per-chunk SQL append, the message-body
pattern) + `subagentToolCalls` (lean JSON — name/input/status/timestamps, NO outputs; the pane
never renders them, and the card's toolOutput already carries the report). A per-turn recorder
(`record-subagent-activity.ts`) persists + yields the unchanged wire events; the Agent call's own
completion settles lingering 'started' entries (the subagent returned — they only missed their
completion events). Client-side, one derivation home (`deriveSettledAgentActivity`) + a
`ToolCallList` fallback gave every surface the settled pane with zero per-host wiring.

Learnings: "live-only by design" quietly violated the 19b no-reflow-on-settle doctrine the moment
it shipped — the pane vanished at settle. Parity asks are best audited property-by-property
(realtime / shared component / after-complete) rather than as one yes/no; two thirds being real
hid the missing third. And lean persistence (drop what the renderer never reads — subagent tool
outputs) turned a scary "persist the whole sub-transcript" fork into two additive columns.

Gate GREEN 504f/2656t. Migration 0010 additive, applies on boot. Known limit recorded: mid-run
Watch attach shows post-attach activity only until the settle refetch (overlay-wins; offset-merge
is a follow-on).

Round 2 (Chad's screenshot): the full nested activity list flooded the thread under parallel
agents — replaced in-thread with a one-line live ticker (latest action, active agents only);
the full pane now renders only in the Watch focused view (live or persisted). Learning: persist
first, THEN slim the live surface — because the focused view reads the recorded copy, the thread
could go compact without losing anything.

## 19i — delegation replies distilled (the workspace reports, global speaks)

Chad's next report: the global chat (and Telegram) received the workspace's entire working report
verbatim. The mental model he named — workspace reports to GLOBAL, global composes what the user
reads — mapped exactly onto the existing one-shot-distill machinery: `summarizeReport` joined the
provider seam as `summarizeSession`'s sibling (fresh ephemeral haiku dispatch, no tools,
null-on-failure), and the delegation tick now distills a >700-char report once, delivering the
short reply to both the global row and the origin channel with per-target format rules. Fail-open
everywhere: a failed distill delivers the full report — losing the answer is worse than losing
the polish. The full report never left the system: the job row + workspace transcript keep it,
and 19h's persistence means the Watch drill-down shows the whole run.

Learning: the 19h slice was load-bearing for this one — compressing the surface reply is only
safe because the full detail has a durable, reachable home. Order of operations matters:
persist the truth first, then you may shorten every surface that repeats it.
