# A Monitor primitive for Claude (2026-07-26) — findings, not yet built

Chad's ask, clarified over two rounds: *"Background run after complete session will notify and
monitor like claude code has"* → *"what I wanted you to build, on Claude Code it can set a monitor
that gets triggered on getting data."*

That names Claude Code's **Monitor** tool specifically. Its contract is **push, not poll**: the
agent arms a watch, **keeps working**, and events arrive as notifications mid-flight. The tool
description is explicit that events "arrive on their own schedule and are not replies from the
user." That last property is the whole point — and it is the one Vynel cannot currently express.

## What already exists (so this is NOT the gap)

| Need | Status |
|---|---|
| Claude learns a delegated run finished | ✅ Two paths. The child's report is enqueued as a **report-delivery** job that wakes the requester as a real turn; if that enqueue fails, the job is left UNSURFACED and the root's **next-turn catch-up** (`collectDelegationReportsForRoot`) prepends it to the provider input, marked exactly-once. |
| A live view of in-flight work | ✅ `listInFlightDelegations` — but wired only to the UI indicator. |
| Claude reads back a `jobId` | ❌ `send_task_to_workspace` returns `{status:'enqueued', jobId}` and **no tool accepts that jobId**. A dead handle. |
| Claude is woken **mid-turn** by data | ❌ — see below. |

## The blocker: Vynel runs the SDK in single-prompt mode

`run-claude-chat-session.ts:108` calls `query({ prompt: imageHandling.modifiedPrompt, options })`
where `prompt` is a **string**. The SDK also accepts an `AsyncIterable` of user messages
(streaming-input mode) — that is how a harness pushes a notification into a turn that is already
running. Vynel does not use it.

Consequences, all of which follow from that one line:

- There is no way to deliver an event **into a running turn**. The `SyntheticEventQueue` looks
  like the seam but is not — it interleaves events toward the *consumer* (UI/persistence), never
  back into the model's context.
- Vynel's turn model is deliberately **one-shot**: `buildClaudePreToolUseHook` even forces
  subagents synchronous (`run_in_background: false`) because "Vynel's one-shot turn model tears
  the query down when the main turn ends, silently killing a background agent mid-run."
- So today a monitor could only ever fire on the turn *after* the data arrived — which is the
  catch-up net that already exists, not the Monitor primitive Chad asked for.

## The fork for Chad

**A. Monitor-shaped, within the one-shot model (small).** Arm a watch that resolves *during the
current turn*: a `wait_for_background_run(jobId, timeoutMs)` tool that parks on the job reaching a
terminal state and returns its result. Plus the two read tools below. No AI-seam change; the agent
gets push-like behavior as long as it is willing to wait inside the turn. Does not survive a turn
boundary — but every bound must obey the hang audit (`docs/module-notes/mcp-tool-hang-audit.md`):
a parked tool needs a hard deadline, or it becomes the exact failure that audit just closed.

**B. True Monitor (deep — touches the sacred AI seam).** Move `runClaudeChatSession` to
streaming-input mode so external events can be injected into a live turn. This is the only way to
get Claude Code's actual semantics. It changes the one-shot turn model, which the subagent
force-sync decision and the whole delegation tick are built on. Needs its own brief.

**C. Monitor tools only (smallest).** `list_background_runs` + `get_background_run(jobId)` —
read-only GETs over queries that already exist (`listInFlightDelegations`, `findDelegationJobById`).
Makes the returned `jobId` usable and lets Claude poll deliberately. Not push, but it closes the
dead-handle gap in one small slice and is a prerequisite for A regardless.

**Recommendation: C now (it is a strict prerequisite and carries no risk), then A.** B only if
Chad wants real mid-turn wake-ups, and only behind its own brief — it is the one change that
touches the AI seam the contract calls sacred.
