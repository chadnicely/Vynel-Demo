# Nodes screen — Follow-ups

> Open items for `/nodes` — the constellation view and its **message arcs**, the line that travels between two dots when one of Vynel's conversations sends something to another.
>
> **The `overview.md` / `structure.md` pair for this unit is not written yet.** This file exists on its own because there were findings to record now; the pair marks the book's shape and should be written when someone next works this area.
>
> Establishment markers, as in the [session-communication register](../session-communication/followup.md): **probed** (reproduced against a real DB), **reviewed** (found by a `code-reviewer` pass), **read** (traced in code, not executed). Everything below is **read** — the screen itself was not run.

Opened 2026-08-16.

---

## How it works, in one chain

Needed to read any item below; the full map belongs in the unwritten `structure.md`.

```
delegation_jobs  →  listDelegationJobsSince        windowed, EVERY jobKind
                 →  listRecentMessageEdges          row → endpoints, deliberately unresolved
                 →  GET /activity/recent-messages   no x-mcp — a UI helper, not a tool surface
                 →  useMessageEdges                 poll 8s, ask for 120s of history
                 →  fleetMessages | projectMessages match ids against what is on screen
                 →  constellation-scene             head travels 1.4s, arc lingers 60s
```

Three load-bearing decisions: the query **reports endpoints and never resolves them** (so one read serves both the fleet and a single project, and an unmatchable endpoint collapses to the core — the global root); a reply's sender is recovered by **walking the thread** to the ask that started it (a delivery row knows who it is *for* but not where it came *from*); and it is **polled, not pushed**, because the activity feed's vocabulary is turn liveness and a 60-second line does not justify extending that contract.

> **Context for anyone comparing against older behavior:** until `d40f4de` the fleet silently under-drew workspace-originated traffic. `fromWorkspaceId` on an ask reads `job.requesterWorkspaceId`, which only mention runs used to populate — so a workspace→workspace ask drew *core → B* instead of *A → B*, and a workspace→session ask had both ends null and was **dropped entirely** by `keep()`. Not a nodes bug and nothing to change: it corrected itself when that column started carrying truth.

---

## Open items

### 1. A busy window silently drops the oldest arcs
**read** · `packages/orchestration/src/repositories/delegation-jobs.ts:600-617` · `apps/local-api/src/routes/activity/index.ts:141`

`listDelegationJobsSince` orders `desc(createdAt)` and caps at `DEFAULT_LIST_LIMIT` (50). The route calls `listRecentMessageEdges` with **no** `limit`, so a 120-second window containing more than 50 messages returns only the newest 50 — the rest are dropped with no signal, on a screen whose entire purpose is "see what just happened."

Arcs live 60s and the window is 120s, so a fleet busy enough to exchange >50 messages in two minutes loses the older half of its picture exactly when there is most to see.

**Fix shape** — either raise the cap for this consumer (`MAX_LIST_LIMIT` is 100) or return a truncation flag the view can surface. A silent cap on a visualization reads as "nothing else happened", which is the one thing it must not say.

### 2. `direction` flattens every upward kind into one arc
**read** · `packages/orchestration/src/queries/list-recent-message-edges.ts:69-72`

`isDeliveryJobKind` maps `report-delivery`, `update-delivery`, and `direct-delivery` all to `direction: 'reply'`. On screen an interim ack, a final result, and an answer addressed to the user are indistinguishable — three semantically distinct things drawn identically, on what is the only visible surface of session-comms.

The changelog frames the two colours as *"going out is one colour, coming back is another, so an exchange reads as question and answer at a glance."* That reading is intact; the question is whether "coming back" deserves to be one thing.

**Fix shape** — widen `MessageEdgeDirection` to carry the kind (the wire type already ships `jobId`, so this is additive) and let the scene decide whether to distinguish them. **Product call first**: more arc colours may cost more than the distinction is worth.

### 3. `senderWorkspaceOfReply` is an N+1
**read** · `packages/orchestration/src/queries/list-recent-message-edges.ts:51-62,76`

One `listDelegationJobsByThread` query per reply edge, executed inside the `.map()` — up to 50 extra queries per poll, every 8 seconds while the screen is open.

Cheap today: local SQLite, and `idx_delegation_jobs_thread` covers the lookup. Recorded because it is structurally per-row and will be the first thing to hurt if item 1's cap is raised — the two interact, and raising the cap without addressing this multiplies both.

**Not a bug, checked:** its thread read is capped (50, no `unbounded`) but that cannot miss here — the chain is ordered ascending and the opening ask is an early hop, so the first work hop is always inside the window.

---

## Considered and correct — do not "fix" these

- **Sessions collapse to the core on the fleet.** The fleet draws workspaces; a session endpoint is unmatchable there and resolves to the centre. Deliberate, and the query's own header says so.
- **A message whose two ends are the same is dropped** (`message-scene-mapping.ts`, `keep()`). Relevant to session-communication followup item 7 (a self-send is possible and unenforced) — the picture already refuses to draw a loop.
- **The window (120s) is twice the arc lifetime (60s).** So a screen that just opened still catches an arc already in flight.
- **Polled, not pushed.** See the chain above.

---
*Opened 2026-08-16 while researching `/nodes`. Close an item by fixing it and deleting the entry.*
