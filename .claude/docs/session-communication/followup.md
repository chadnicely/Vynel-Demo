# Session Communication — Follow-ups

> Open bugs and considered-but-deferred items for the session-messaging seam. The third file beside [overview.md](./overview.md) (the idea) and [structure.md](./structure.md) (the code map) — this one is **what is still wrong or still owed**.
>
> Every entry says how it was established: **probed** (reproduced against a real DB), **reviewed** (found by a `code-reviewer` pass), or **read** (traced in code, not executed). Nothing here is a guess. An item that turns out not to reproduce should be deleted, not softened.
>
> [Proposed](#proposed--research-before-building) is a separate section on purpose — it describes code that **does not exist**. Nothing in it is shipped behavior, and it carries no establishment marker because there is nothing yet to establish.

Opened 2026-08-16, out of the `deliveredTo` / requester-threading arc (`8b62ab3` → `0043589`).

---

## Open bugs

### 1. A workspace task 400s when the calling workspace has no live primary
**Introduced** by `d40f4de` · **reviewed** · `apps/local-api/src/routes/routing/dispatch-message.ts:131`

`resolveTaskSender` requires the calling workspace's primary to carry a `currentSdkSessionId`. Before both task dispatchers shared it, `dispatchTaskToWorkspace` ignored the caller entirely and parented on the global root, so this call succeeded.

Reachable: `create_session` can ground a session in a workspace whose primary has never run a turn. That session's delegated turn then carries `workspaceId: W` ambiently, and its `to: "workspace:C"` send 400s where it used to work. The model gets an error it cannot act on.

**Fix shape** — separate the two concerns the change conflated: fall back to the global root for **provenance** (`parentSessionId`) while still recording W as the **requester** (so the report still reaches W's chat). That also makes the pinned session-branch 400 at `index.test.ts:674` obsolete: its stated rationale is *"so the report returns to the creator,"* which no longer rides `parentSessionId`. Flipping a deliberately-pinned test is Chad's call, which is why it stopped here.

**Status** — current behavior pinned with a pointer comment (`index.test.ts`, "400s a workspace task whose CALLING workspace has no live primary").

### 2. `workspaceId` decides where a report lands, and the model can set it
**Stakes raised** by `d40f4de` · **reviewed** · `apps/mcp/src/generated/api-tools.ts:3009,3018-3023`

It is declared as a tool parameter; `scope.workspaceId` is only a *fallback for an omitted argument*. Before, it picked the job's provenance parent. Now it picks **where the target's report lands**, on both task branches.

That contradicts the dispatcher's own header rule (`dispatch-message.ts:11-15`): *"AMBIENT CONTEXT, NEVER MODEL INPUT … a mis-addressed message is unrecoverable once enqueued."* Ownership-checked, so the blast radius is the user's own workspaces — a model running in A can name B and send A's answer to B's chat.

**Not locally patchable.** The generator's `ambientWorkspace` flag (`scripts/src/generators/generate-mcp-tools.ts:97-103`) is all-or-nothing, and opting out would kill the workspace surface's ambient grounding. The missing primitive is **"stamp only, never accept from the model"** — a third state alongside accept-with-fallback and never-stamp. Design decision, not a local fix.

### 3. A root-tasked, workspace-grounded session reports to its grounding, not the root
**Pre-existing** · **reviewed** · `apps/local-api/src/routes/routing/dispatch-message.ts:312-314`

The global root tasks session S grounded in workspace W. No requester is recorded (the root has no calling workspace), so the upward resolver falls through to S's grounding and the report lands in W's chat — not back at the root that asked.

This is the same family as the bugs `d40f4de` closed and contradicts the "report to whoever asked" rule that commit established, but it was **not** introduced there and is deliberately unchanged: flipping it moves reports out of the workspace chats where users see them today.

**Fix shape** — a job-level "asked by the root" marker. Do **not** overload the absence of `requesterWorkspaceId` a third time; absence already means "nobody below the root asked" going down and "fall back to grounding" coming up, and a third meaning is how this class of bug keeps recurring.

---

## Considerable

Not wrong today, but sharp edges the next change is likely to hit.

| # | Item | Where | Note |
|---|---|---|---|
| 4 | **The no-turn direct path is global-requester only.** With a *workspace* requester, `direct_to_user` still runs a full notify turn under the direct steer — there is no workspace-side absorb net. Pre-existing; the workspace→workspace fix made it substantially more reachable. | `run-report-delivery-tick.ts:169` | **reviewed** |
| 5 | **The catch-up net is user-wide, not requester-aware.** A workspace→workspace task answering `direct_to_user` leaves its row unsurfaced, so the *global root* absorbs it although the requester is the asking workspace. Pre-existing; more reachable now. | `run-delegation-claim-and-run-tick.ts:645-650` | **reviewed** |
| 6 | **`model` / `thinkingEffort` are silently dropped on a `requester` send.** Validated by the schema (an illegal model still 400s) then discarded — asymmetric with `kind`/`title`, which are strictly cross-validated. | `routes/routing/index.ts` (task branches only) | **read** |
| 7 | **"Never the target workspace itself" is unenforced.** `dispatchTaskToWorkspace` never compares the calling workspace to the target, and `list_routing_workspaces` returns all of the user's workspaces without excluding the caller. Harmless today — the upward self-guard drops a self-override and the report terminates at the root instead of looping. | `enqueue-workspace-delegation.ts` field doc | **reviewed** |
| 8 | **`deliveredTo` for a `session:` task reads the raw input id**, not the resolved primary. Correct as written (the handle *is* the segment id) but it will drift if the handle's meaning ever changes. | `dispatch-message.ts` (`findChatSessionById(input.targetSessionId)`) | **read** |
| 9 | **Schedule fires hold `send_message` but cannot speak upward.** They compose the plain workspace descriptor, which never stamps the caller header, so `to: "requester"` 400s. Correct by design; the tool description does not say so, and the model discovers it by failing. | `build-workspace-background-mcp.ts:47-72` | **read** |
| 10 | **`ThreadChainHop.target` names the SENDER on a delivery hop.** Field named `target`, documented as "the other party". Currently **zero consumers** — free to rename now, expensive once wired. | `resolve-thread-chain.ts` | **read** |

---

## Debt

| # | Item | Note |
|---|---|---|
| 11 | **`dispatch-message.ts` is ~466 lines** against the ~300 guideline. Split shape is known and clean: `resolve-upward-sender.ts` (the addressing core) from the dispatchers, both then under 300. | Explicitly deferred by Kafi (2026-08-16) — do not slip it into a behavior change. |
| 12 | **`orchestration/structure.md` is stale** (mapped 2026-07-14, seven migrations behind on `delegation_jobs`). Annotated with a warning + pointer here rather than re-mapped. | A full re-map is its own move. |
| 13 | **Tool rows persisted before `8b62ab3` keep the wrong `deliveredTo`** in their stored JSON. No backfill exists and none is planned — the settled pointer reads that field. | Inherent consequence, not a defect. |
| 14 | **Session-target requester threading through the tick is untested.** It rides the same line the workspace-target test now pins (`run-delegation-claim-and-run-tick.ts:434`), so the risk is low. | Cheap to add. |
| 15 | **`findRequesterWorkspace`'s re-throw branch is untested** — unreachable without mocking the DB, which the house rules forbid. | Leave as is. |
| 16 | **The tick test's absence assertion is weaker than it reads.** `expect.not.objectContaining({ requesterWorkspaceId: expect.anything() })` also passes for a present-but-`undefined` key, which `exactOptionalPropertyTypes` treats as distinct. Harmless (the composer checks `!== undefined`). | Noted so nobody mistakes it for an absence proof. |

---

## Proposed — research before building

> **NOT BUILT. NOT DECIDED.** Nothing below exists in the code. Kafi, 2026-08-16: *"we won't build this, we will have more research before building it."* Recorded so the design work isn't redone from scratch.

### A lateral kind — one session tells another something

**The gap.** Every kind today is hierarchical: down to a subordinate, or up to a requester. There is no way to address a peer *without giving it work* — `workspace:` and `session:` destinations **derive** `task`. A session that just wants to say "I'm editing this file, leave it alone" has to hand out a task to do it.

| kind | direction | creates work? | expects a reply? | closes a task? |
|---|---|---|---|---|
| `task` | down | ✅ | a report | — |
| `update` | up | ❌ | ❌ | ❌ |
| `report` | up | ❌ | ❌ | ✅ |
| `direct_to_user` | up (to the human) | ❌ | ❌ | ✅ |
| *proposed* | **sideways** | ❌ | ❌ | ❌ |

**Naming: not `direct_message`, not `dm`.** `direct_to_user` already exists. Two kinds sharing a `direct_` prefix that mean **opposite destinations** — one to the human, one to a peer session — is a confusable pair, and picking the wrong one delivers the user's answer to another session with no error raised. The generator states the principle for tool *names* (`scripts/src/generators/generate-mcp-tools.ts:84-96`: picking wrong between near-identical options "is a silent misroute, not an error"); it applies at least as strongly to kinds inside one enum, where the model chooses on every call. `dm` also reads as user-to-user in every chat product, which is the opposite of what this is. **`note`** was the working suggestion: no prefix collision, and it says you are telling, not asking.

**The fork that decides the design — does it run a turn?**

- **A · notify turn.** The target wakes and absorbs under a "do not act" steer. Costs a full turn per note, risks the target starting work anyway (instruction decay is a *known* failure here — it is why the attribution markers exist at all), and two sessions can ping-pong without bound.
- **B · persist, no turn.** Lands on the target's transcript, absorbed on its next natural turn. Free, cannot loop, cannot start work. This is what `direct_to_user` already does.

**B is the right shape** — a notification that costs a turn is a task with extra steps. But B is **blocked**: the absorb-without-a-turn machinery is global-root-only. `collectDelegationReportsForRoot` has exactly one consumer (`packages/session/src/runtime/run-global-root-turn-core.ts:176`) and `recordDirectReplyMessage` is only reachable behind the `isGlobalRequester` gate (`run-report-delivery-tick.ts:169`). A workspace primary has no catch-up net, so anything delivered to it must run a turn to be seen. **Build the workspace-side absorb net first** — items 4 and 5 above are the same missing piece, so it pays for three things at once.

**What it would cost, once unblocked.** Small, because the existing structure anticipated it:

- `DELIVERY_JOB_KINDS` (`packages/orchestration/src/schema/delegation-jobs.ts:49`) is the one-home predicate: adding a `note-delivery` kind there mechanically updates the claim exclusion, `isWorkJobKind`, `list_background_runs` filtering, the in-flight list, and the catch-up filter.
- Validation changes shape: a downward destination currently *derives* `task`, so the new kind has to be explicitly permitted downward (downward kinds become `{task, note}`), and addressed to `requester` it must 400 — the requester already has `update` and `report`.
- It must not mark anything reported and must not create a background run.

**What the research has to answer.**

1. **Does it earn its place?** Every kind is one more thing the model can pick wrong. "Notify each other" covers three different needs and only one is really a note: *coordination* ("I'm editing this file") — a note fits; *broadcast* ("the build is red") — notes are point-to-point, broadcast is a different feature; *"I finished the part you were waiting on"* — that is a **report** on a chain, and routing it as a note would lose the task-closing semantics. If the driving case is the third, this kind is the wrong tool and would paper over a chain that is not wired up.
2. **Who may address whom?** Task sends are ownership-checked but hierarchical by convention. Lateral notes let any session address any other. Decide whether that is bounded (same workspace? same chain?) or open — before it ships, not after.
3. **What stops chatter?** With shape B a loop is structurally impossible, but nothing bounds *volume*. Coalescing (as `update` already does) may be the answer, or a per-chain cap.

---

## Settled here — do not reopen without a reason

- **One requester rule, every caller kind** (Chad, 2026-08-16): whoever asked → the sender's own grounding → the global root. No per-kind topology.
- **Workspace→workspace sends are supported**, not blocked (Chad, 2026-08-16): managers talk to managers, and each workspace distributes to its own sessions.
- **`send_message` never cards.** `destructiveHint: true` in the generated annotations does not imply an approval card; carding comes from `mutatingToolNames` / `askModeApprovalToolNames`, and it is in neither.
- **No harvest** (Chad, 2026-07-27): a receiver's ordinary chat reply is never captured as a report. A silent worker delivers nothing, deliberately.

---
*Opened 2026-08-16 from the `deliveredTo` / requester-threading arc. Close an item by fixing it and deleting the entry — a followup list nobody prunes becomes archaeology.*
