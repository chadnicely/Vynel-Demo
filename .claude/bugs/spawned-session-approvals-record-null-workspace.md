# A spawned session's approvals are recorded global, never against its workspace

**Status:** FIXED 2026-08-17 (`delegate-to-spawned-session.ts` — see Resolution)
**Kind:** defect
**Area:** `packages/session` (delegation grounding) → `packages/approvals` + `packages/asks` scoping
**Opened:** 2026-08-16 (surfaced while specifying what a workspace's "waiting" state should mean)

## Symptom

A spawned session working **inside** a workspace raises an approval card that persists with
`workspace_id = NULL`. Two consequences, both user-visible:

- the **parent workspace never lights** for its own child's approval — it can't, the row doesn't
  name it;
- the **Global scope lights instead**, for work that isn't global.

Same shape for asks.

## Root cause

`packages/session/src/delegation/delegate-to-spawned-session.ts:161` hard-codes the ground into the
shared consumption pipeline:

```ts
const turnStream = consumeSessionEventStream({
  …
  workspaceId: null,            // ← unconditional
  workspacePath: input.runCwdPath,
```

From there it flows straight through: `consume-session-event-stream.ts:381-386` →
`handleApprovalRequested` → `recordApprovalRequest`
(`packages/approvals/src/requests/record-approval-request.ts:68`), which persists whatever it was
handed. `handle-approval-requested.ts:26-28` documents `null` as meaning *"a global-root (brain)
session"* — so a workspace-grounded spawned session is being filed as if it were the brain.

**The sibling path already does it right.** `delegate-to-agent-session.ts:150` is the identical call
site — same `workspacePath: input.runCwdPath`, same everything — differing in exactly one line:

| path | line | ground |
|---|---|---|
| `delegate-to-workspace-root.ts` | 161 | `workspaceId: input.workspaceId` ✔ |
| `delegate-to-agent-session.ts` | 150 | `workspaceId: primary.workspaceId` ✔ |
| `delegate-to-spawned-session.ts` | **161** | `workspaceId: null` ✘ |

The spawned primary **knows** its workspace — `primary_sessions.workspace_id` is populated for these
rows. The pipeline just doesn't read it.

## Evidence (dev DB, 2026-08-16)

Every approval a spawned session ever raised, grouped by the project that owns the session:

| sdk session | owner project | scope | approvals | recorded null-workspace |
|---|---|---|---|---|
| `56371297…` | letterman | spawned | 26 | **26** |
| `b59c70ef…` | letterman | spawned | 23 | **23** |
| `b7bd2395…` | letterman | spawned | 3 | **3** |
| `5a37e367…` | Claw Launcher | spawned | 13 | **13** |
| `2460cb6d…` | (global) | spawned | 5 | 5 ✔ correct |
| `cf4eb9a2…` | (global) | global | 4 | 4 ✔ correct |
| `b1080593…` | letterman | workspace | 3 | 0 ✔ correct |
| `e62e2a5c…` | vynel | workspace | 6 | 0 ✔ correct |

**65 child approvals across letterman and Claw Launcher, none of which could ever light its parent.**
Only `scope='workspace'` continuing sessions carry the id.

## What is NOT wrong

- **A genuinely global-grounded spawned session SHOULD be null**, and is. The file header
  (`delegate-to-spawned-session.ts:19`) records `workspaceId` null as the v1 ground for that case —
  the defect is that it's *unconditional*, not that null is ever wrong.
- **Nullable `approval_requests.workspace_id` is deliberate** and load-bearing: it's what lets a
  brain-session card reach the user's global queue instead of being lost to the stream (the
  stuck-card fix). Don't "fix" this by making the column NOT NULL.
- The approval **resolves** correctly either way — `resolve-approval.ts:53` notes `workspaceId` is
  deliberately not part of the resolve path. This is a routing/attribution bug, not a correctness one
  for the card itself.

## Why it matters now

It blocks the agreed definition of a workspace's waiting state (Kafi, 2026-08-16): *"any child of the
workspace needs an approval, or the workspace set `needs_input` itself."* Half two is shipped —
`set_workspace_status` is in the tool catalog for `spawned` among other surfaces. Half one cannot be
implemented on top of rows that don't name the workspace. See
[`nodes-screen-invents-needs-you`](./nodes-screen-invents-needs-you.md).

## The fix, when we take it

Pass `primary.workspaceId` instead of `null` — the established house pattern, already live one file
over in `delegate-to-agent-session.ts:150`. A global-grounded spawned primary carries a null
`workspaceId` anyway, so the correct global behaviour falls out of the same expression rather than
needing a branch.

**Check the blast radius before flipping it** — `workspaceId` grounds more than the approval row in
that pipeline:

- task attribution (`messageAttribution`, the "From Global" label + trace key);
- the MCP attachment — the header at `delegate-to-spawned-session.ts:83` warns that *adding* tools to
  a spawned primary is safe but *stripping* them is the "server disconnected" bug, so the
  per-grounding forward-consistency invariant has to survive the change;
- `workspacePath` stays `input.runCwdPath` regardless — the run cwd and the workspace id are separate
  facts here, and conflating them is the trap.

Asks need the same pass: `runAskUserBridge` takes `scope.workspaceId`
(`packages/asks/src/mcp/ask-user-tool.ts:66-68`) and inherits whatever the turn was grounded with.

Existing rows stay mis-scoped; a backfill from `primary_sessions.workspace_id` is possible but only
worth it if the historical queue matters.

## Reproduce

Delegate to a workspace-grounded spawned session and have it hit a carded tool:

```sh
sqlite3 .data/vynel.dev.db "
select ar.session_id, w.name, ar.workspace_id
from approval_requests ar
left join primary_sessions ps on ps.current_sdk_session_id = ar.session_id
left join workspaces w on w.id = ps.workspace_id
where ps.scope = 'spawned' and w.name is not null;"
```

Every row comes back with a project name and a null `workspace_id`.

## Resolution (2026-08-17)

One line, the shape this file predicted: `workspaceId: null` → `workspaceId: primary.workspaceId`
in the `consumeSessionEventStream` call. The spawned primary is already resolved three statements
above (the ownership/scope/link checks), and the tick had *already* computed the same value for the
MCP attachment (`run-delegation-claim-and-run-tick.ts` → `spawnedTargetWorkspaceId`) — only the
persistence pipeline disagreed with it. A global-grounded primary carries null anyway, so no branch.

**A second symptom the same line caused**, not noticed when this was written: `workspaceId` also
feeds `handleSessionStarted`, so a mid-turn compaction swap wrote the fresh segment with a null
workspace while the BIRTH segment (`recordSpawnedSessionSegment`, which reads
`input.workspaceId`) carried the room's id. A workspace-grounded spawned session therefore
migrated out of its room's Sessions list on its first context swap. Fixed by the same change; the
regression test asserts the segment's ground too.

**Both groundings are pinned** in `delegate-to-spawned-session.test.ts` — the workspace case
(card names the room AND the session) and the global case (null stays null, which was never
wrong). The workspace test fails against the old line with `expected null to be '<workspace id>'`.

**No UI change was needed:** `use-workspace-status.ts` already routes a card by
`row.workspaceId === null ? global : that workspace`, so the room lights as soon as the data is
honest.

### The asks half of this report is MOOT — checked, not fixed

The original write-up said "asks need the same pass". They do not, because an ask can never be
raised on the mis-grounded path: `buildAskFeatureDescriptor` is attached at exactly three sites
(`streams/chat-turn.ts`, `streams/global-root-turn.ts`, `sessions/run-global-root-turn.ts`), and a
delegated spawned-session turn composes none of them — it gets the routing/interactive + notebook
+ desktop descriptors only. Every reachable ask is already grounded correctly (a workspace chat
passes its workspace; the two global paths pass null, which is what the brain IS).

**A different asks gap does exist**, unrelated to grounding: a workspace chat turn composes its
toolset BEFORE the turn's session id is known (that is what the `turnSession` carrier exists for),
so it passes no `sessionId` and asks from a workspace chat record `session_id` NULL — while the
global path passes `conversationTarget.primarySessionId` and does record one. Consequence is
narrow: the per-session status ladder counts pending APPROVALS only, so a conversation blocked on
`ask_user` reads idle rather than "waiting on you". Fixing it means giving the descriptor context a
lazy session accessor instead of a static id. Filed as its own item rather than smuggled in here.

### Existing rows

Left as they are. The 65 historical cards stay mis-scoped; they are long resolved, and a backfill
from `primary_sessions.workspace_id` is only worth it if the historical queue ever matters.
