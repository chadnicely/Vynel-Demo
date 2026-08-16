# Session Communication — Follow-ups

> Open bugs and considered-but-deferred items for the session-messaging seam. The third file beside [overview.md](./overview.md) (the idea) and [structure.md](./structure.md) (the code map) — this one is **what is still wrong or still owed**.
>
> Every entry says how it was established: **probed** (reproduced against a real DB), **reviewed** (found by a `code-reviewer` pass), or **read** (traced in code, not executed). Nothing here is a guess. An item that turns out not to reproduce should be deleted, not softened.

Opened 2026-08-16, out of the `deliveredTo` / requester-threading arc (`8b62ab3` → `0043589`). The 2026-08-16 "Proposed — lateral kind" research section became shipped code on 2026-08-17 — see [Shipped from here](#shipped-from-here--the-lateral-kind-2026-08-17).

---

## Open bugs

### 1. A workspace task 400s when the calling workspace has no live primary
**Introduced** by `d40f4de` · **reviewed** · `apps/local-api/src/routes/routing/dispatch-message.ts:131`

`resolveTaskSender` requires the calling workspace's primary to carry a `currentSdkSessionId`. Before both task dispatchers shared it, `dispatchTaskToWorkspace` ignored the caller entirely and parented on the global root, so this call succeeded.

Reachable: `create_session` can ground a session in a workspace whose primary has never run a turn. That session's delegated turn then carries `workspaceId: W` ambiently, and its `to: "workspace:C"` send 400s where it used to work. The model gets an error it cannot act on.

**Fix shape** — separate the two concerns the change conflated: fall back to the global root for **provenance** (`parentSessionId`) while still recording W as the **requester** (so the report still reaches W's chat). That also makes the pinned session-branch 400 at `index.test.ts:674` obsolete: its stated rationale is *"so the report returns to the creator,"* which no longer rides `parentSessionId`. Flipping a deliberately-pinned test is Chad's call, which is why it stopped here.

**Status** — current behavior pinned with a pointer comment (`index.test.ts`, "400s a workspace task whose CALLING workspace has no live primary").

### 2. `workspaceId` decides where a report lands, and the model can set it
**Stakes raised** by `d40f4de` · **reviewed** · `apps/mcp/src/generated/api-tools.ts:3009,3018-3023` · **extended** by the note kind (2026-08-17): on a `kind: "note"` send the same parameter picks the SENDER identity — a model running in A can name B and sign the note as B's manager (ownership-checked, so the blast radius stays the user's own workspaces).

It is declared as a tool parameter; `scope.workspaceId` is only a *fallback for an omitted argument*. Before, it picked the job's provenance parent. Now it picks **where the target's report lands**, on both task branches.

That contradicts the dispatcher's own header rule (`dispatch-message.ts:11-15`): *"AMBIENT CONTEXT, NEVER MODEL INPUT … a mis-addressed message is unrecoverable once enqueued."* Ownership-checked, so the blast radius is the user's own workspaces — a model running in A can name B and send A's answer to B's chat.

**Not locally patchable.** The generator's `ambientWorkspace` flag (`scripts/src/generators/generate-mcp-tools.ts:97-103`) is all-or-nothing, and opting out would kill the workspace surface's ambient grounding. The missing primitive is **"stamp only, never accept from the model"** — a third state alongside accept-with-fallback and never-stamp. Design decision, not a local fix.


---

## Considerable

Not wrong today, but sharp edges the next change is likely to hit.

| # | Item | Where | Note |
|---|---|---|---|
| 4 | **The no-turn direct path is global-requester only.** With a *workspace* requester, `direct_to_user` still runs a full notify turn under the direct steer — there is no workspace-side absorb net. Pre-existing; the workspace→workspace fix made it substantially more reachable. | `run-report-delivery-tick.ts:169` | **reviewed** |
| 5 | **The catch-up net is user-wide, not requester-aware.** A workspace→workspace task answering `direct_to_user` leaves its row unsurfaced, so the *global root* absorbs it although the requester is the asking workspace. Pre-existing; more reachable now. | `run-delegation-claim-and-run-tick.ts:645-650` | **reviewed** |
| 7 | **"Never the target workspace itself" is unenforced.** `dispatchTaskToWorkspace` never compares the calling workspace to the target, and `list_routing_workspaces` returns all of the user's workspaces without excluding the caller. Harmless today — the upward self-guard drops a self-override and the report terminates at the root instead of looping. | `enqueue-workspace-delegation.ts` field doc | **reviewed** |
| 8 | **`deliveredTo` for a `session:` task reads the raw input id**, not the resolved primary. Correct as written (the handle *is* the segment id) but it will drift if the handle's meaning ever changes. | `dispatch-message.ts` (`findChatSessionById(input.targetSessionId)`) | **read** |
| 9 | **Schedule fires hold `send_message` but cannot speak upward.** They compose the plain workspace descriptor, which never stamps the caller header, so `to: "requester"` 400s. Correct by design; the tool description does not say so, and the model discovers it by failing. | `build-workspace-background-mcp.ts:47-72` | **read** |
| 10 | **`ThreadChainHop.target` names the SENDER on a delivery hop.** Field named `target`, documented as "the other party". Currently **zero consumers** — free to rename now, expensive once wired. | `resolve-thread-chain.ts` | **read** |

---

## Debt

| # | Item | Note |
|---|---|---|
| 12 | **`orchestration/structure.md` is stale** (mapped 2026-07-14, seven migrations behind on `delegation_jobs`). Annotated with a warning + pointer here rather than re-mapped. | A full re-map is its own move. |
| 13 | **Tool rows persisted before `8b62ab3` keep the wrong `deliveredTo`** in their stored JSON. No backfill exists and none is planned — the settled pointer reads that field. | Inherent consequence, not a defect. |
| 14 | **Session-target requester threading through the tick is untested.** It rides the same line the workspace-target test now pins (`run-delegation-claim-and-run-tick.ts:434`), so the risk is low. | Cheap to add. |
| 15 | **`findRequesterWorkspace`'s re-throw branch is untested** — unreachable without mocking the DB, which the house rules forbid. | Leave as is. |
| 16 | **The tick test's absence assertion is weaker than it reads.** `expect.not.objectContaining({ requesterWorkspaceId: expect.anything() })` also passes for a present-but-`undefined` key, which `exactOptionalPropertyTypes` treats as distinct. Harmless (the composer checks `!== undefined`). | Noted so nobody mistakes it for an absence proof. |

---

## Shipped from here — the lateral kind (2026-08-17)

The proposed "note" kind was **built** (Kafi's call this session, answering the recorded research questions). What shipped, and where the design deliberately diverged from the 2026-08-16 lean:

- **`kind: "note"`**, exactly the proposed name — the `direct_` prefix-collision argument held.
- **Anyone→anyone** (research question 2, answered by Kafi): a note crosses the parent lines the own-child TASK rule refuses, because it cannot hand out work. Self-notes 400 (a session to itself; a primary to its own workspace); a session noting its own manager is legal.
- **Shape A won, not shape B.** The 2026-08-16 lean toward persist-no-turn missed the killing case: an idle *spawned session* has no natural next turn, so a persisted-only note is never absorbed — "let me know when you're done" would sit unread forever. A note therefore runs a real turn on the target (the task path's target machinery, all three target shapes), and the queue's per-target serialization gives the right timing free: a note to a busy session lands right after its current work finishes. Chatter (question 3) is bounded by the steer only — "reply ONLY if it asks something you can answer now; never reply just to acknowledge" — plus the full-turn cost itself; no structural cap shipped.
- **`WORK_JOB_KINDS`** is the new positive one-home (the proposal's `DELIVERY_JOB_KINDS` route was wrong for this row: a note *targets* like a task, so the delivery machinery must never claim it). Background runs, in-flight, the catch-up, the give-up push, and tool-card labels all filter on it.
- The marker (`[Note from …]`) carries the **reply address** because a spawned receiver may hold no listing tools; a stale address (sender compaction-swapped) 404s like an unknown one.

Register consequences: bug 3 **closed by unreachability** (the own-child rule removed root→workspace-grounded tasking, `aa89c0a`); item 6 **closed** (`model`/`thinkingEffort` now 400 on every non-task kind); debt 11 **closed** (`resolve-upward-sender.ts` split landed first, as its own commit, `71f7146`); item 2 **extended** (the model-settable `workspaceId` now also picks a note's sender identity — see above).

---

## Settled here — do not reopen without a reason

- **One requester rule, every caller kind** (Chad, 2026-08-16): whoever asked → the sender's own grounding → the global root. No per-kind topology.
- **Workspace→workspace sends are supported**, not blocked (Chad, 2026-08-16): managers talk to managers, and each workspace distributes to its own sessions.
- **Own-child task rule** (Kafi, 2026-08-17): a task to `session:<id>` requires the target's grounding to equal the calling scope — grounding IS parenthood (a spawned session inherits its creator's scope at birth). Cross-parent work routes through the owning manager; cross-parent *speech* is what `kind: "note"` is for. This deliberately flipped two 2026-08-16 pins (the "cwd follows the target" sub-pin and "workspace → a GLOBAL-grounded session").
- **Notes are communication, never work** (Kafi, 2026-08-17): no background run, no report expectation, no tracking view, always surfaced at terminal time, no give-up push. "Verify the task pipelines and keep the tracking data ready; notes need none of it."
- **`send_message` never cards.** `destructiveHint: true` in the generated annotations does not imply an approval card; carding comes from `mutatingToolNames` / `askModeApprovalToolNames`, and it is in neither.
- **No harvest** (Chad, 2026-07-27): a receiver's ordinary chat reply is never captured as a report. A silent worker delivers nothing, deliberately.

---
*Opened 2026-08-16 from the `deliveredTo` / requester-threading arc. Close an item by fixing it and deleting the entry — a followup list nobody prunes becomes archaeology.*
