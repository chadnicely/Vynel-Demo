# The node screen says NEEDS YOU when nothing needs you

**Status:** open
**Kind:** defect
**Area:** `apps/local-web` (the Nodes screen) → `composables/nodes`
**Opened:** 2026-08-16 (Kafi hit it on `/nodes` with four idle projects)

## Symptom

Two projects that had merely *chatted* in the last hour wore an amber **NEEDS YOU**, and the fleet
bar counted them under *"2 waiting on you"* — while the sidebar showed both parked and dimmed.
Nothing was pending on either one.

The same node also reads **"Nothing running"** in the Grid tab of that same screen.

## Root cause

`composables/nodes/node-status.ts:29-48` is the whole rule, and `waiting` is its **`else` branch**:

```
quiet for >1h ................................ idle      → "IDLE"
live turn, or a task in-progress .............. building  → "WORKING"
queue drained / all steps done ................ done      → "ALL DONE"
anything else ................................. waiting   → "NEEDS YOU"   ← fallback
```

Two things make that fallback fire on a project with nothing pending:

1. **Chatting counts as working.** `composables/workspaces/use-workspace-progress.ts:83-89` folds the
   continuing session's `lastMessageAt` into `lastWorkedAt`, and `use-active-window.ts:6` makes the
   window an hour. So "said something in the last hour" opens the live states.
2. **Nothing else can claim it.** `done` needs `queue.total > 0` or completed todos
   (`composables/tasks/task-queue-summary.ts:58-66`). A project that has **never held a task** can
   therefore never reach ALL DONE — its only reachable states are WORKING / NEEDS YOU / IDLE.

So the amber label means *"this project spoke recently and I have nothing else to say about it."* It
asserts need from **absence of evidence**.

The deeper miss: **the node screen never reads approvals, asks, or the assistant-set status.** Those
are the actual needs-input facts, and `composables/workspaces/use-workspace-status.ts` already
derives them for the tree, tab strip, work rail and chat header. The one screen named for showing you
what needs you is the only surface not reading the needs-you data.

### Second, independent fault: no loaded-yet guard

`taskQueueByWorkspace(undefined)` returns an empty Map (`task-queue-summary.ts:26-44`), so while
`/api/tasks` is unanswered every recently-active project falls into the same fallback — including one
whose queue is genuinely drained. That is what put **letterman** (4 tasks, all done) in amber in
Kafi's screenshot; it reads ALL DONE once the request lands. The signature is the fleet bar showing
**no "done" chip at all**.

`useFleetNodes` renders a claim about a project from data it does not have. Its sibling
`useProjectNodes` has a `hasAnswered` guard (`use-project-nodes.ts:80-84`) for exactly this case; the
fleet has nothing. Which trigger hit that tab — a failed/retrying fetch, or a remount with a warm
overview and a garbage-collected tasks cache — is not recoverable after the fact, and does not change
the defect.

## Evidence (live, 2026-08-15 ~21:51 UTC)

| project | last spoke | tasks | todos | pending ask/approval | latest turn | node screen |
|---|---|---|---|---|---|---|
| Claw Launcher | 21:29:43Z | **0** | 0 | none | ended cleanly | **NEEDS YOU** |
| letterman | 21:29:51Z | 4, all done | 0 | none | ended cleanly | NEEDS YOU → ALL DONE |
| Seo | Aug 14 01:08Z | 0 | 0 | none | ended cleanly | IDLE |
| vynel | Aug 15 04:09Z | 0 | 0 | none | ended cleanly | IDLE |

`GET /asks/pending` → `[]`. `GET /approvals/pending` → `[]`. `session_todos` is empty for every
continuing session. Pinned against the real module: queue known → `done`, queue undefined →
`waiting`.

## What is NOT wrong

- **The sidebar.** Both projects correctly derive `not_running` and park. The tree is right; the
  constellation is wrong.
- **The divergence is already recorded.** `node-status.ts:19-28` states that the node screen and
  main's navigation surfaces derive status differently, and that merging them changes visible colours
  *"so it needs Chad"*. This entry is that deferred fork met in the wild — not a surprise regression.
- The hour-long window itself is deliberate and shared with the sidebar's Active/Not-running split
  (Chad, 2026-08-12). Don't shorten it to dodge this.

## The rule it should implement (Kafi, 2026-08-16)

A workspace reads **waiting** on exactly two facts, and nothing else:

1. **any child of the workspace needs an approval** — spawned sessions included, not just the
   continuing build;
2. **the workspace set its own state to `needs_input`** via the `set_workspace_status` MCP tool — the
   "task is done but I need direction" case. The user sees the state, opens the workspace, and asks
   the manager which clarification it needs.

Talking recently is not waiting.

## Partially fixed 2026-08-17 — the CONVERSATION dots

The second-level (inside-a-project) conversation dots no longer invent anything:
`resolveConversationNodeStatus` became a pure palette rename of the real ladder, fed by
`deriveSessionStatus` per session (a live turn, a pending approval, the assistant's set state, the
last turn's error) and by the ROOM's own status for "The build". They can now reach `problem`,
which the window-based reading never could.

**What is still open here is the FLEET screen** — the first-level project dots
(`resolveFleetNodeStatus`), which still read the task queue + step dock and still call a
mid-build pause "waiting on you". That is the divergence `node-status.ts` documents, and merging
it changes visible colours, so it needs Chad.

## The fix, when we take it

**A. Ground the child cards first** — ✅ **UNBLOCKED 2026-08-17.**
[`spawned-session-approvals-record-null-workspace`](./spawned-session-approvals-record-null-workspace.md)
is fixed: a spawned session's approvals now name their workspace (and their session), so rule (1)
is implementable — a parent CAN light for its own child's card, and
`use-workspace-status.ts` already routes a card by `row.workspaceId` with no change needed.
Only historical rows stay mis-scoped.

**B. Derive from the shared home.** Drop the invented ladder and read `use-workspace-status` like
every other surface — it already computes `needs_input` from pending approvals + asks + the set
state. That collapses the divergence `node-status.ts:19-28` warned about, so it needs Chad's okay on
the colour change.

**C. Guard the unknown.** Give `useFleetNodes` a `hasAnswered`-style guard so an unresolved
`/api/tasks` never renders as a claim. Independent of A and B — worth taking on its own.

**D. Name the neutral state.** "Active, but nothing pending" has no label today: `idle` already means
*dormant*. Once `waiting` requires a positive fact, most projects land here. Needs a word (READY?
QUIET?) or a deliberate decision to let them wear idle grey while active.

While in there, the same enum currently renders four ways on one screen — canvas `NEEDS YOU`, fleet
bar *"waiting on you"*, `NodesGrid.vue:23` **"Nothing running"** (it collapses everything
non-`building`), and `idle` as `IDLE` on canvas but *"paused"* in the bar.

## Reproduce

Open a chat in any workspace that holds **no tasks**, say anything, then open `/nodes` within the
hour: that project reads NEEDS YOU with nothing pending anywhere. For the loaded-guard half, block
or delay `*/api/tasks` and reload — every recently-active project reads NEEDS YOU and the bar shows
no "done" chip.
