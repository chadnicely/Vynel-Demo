# Session communications (the revert flow) — module notes

**Status:** BUILT overnight 2026-07-21→22 (design 2026-07-21 evening; Chad: "complete the
remaining parts and the communication mcp… in the morning I will smoke test"). Forks
settled by Claude with reasoning recorded — every one is revisitable. **As-built
deviations + open items are recorded at the bottom of this file.**

## Chad's instruction (verbatim intent)

Each level can communicate with the flow (global → workspace → session → agent), and the
REVERSE flow is the point: when a child completes, it reports REAL data back to whoever
requested it — not the current "routed ✅" ack + a detached pushed report later. The
parent is AWARE of the completion in its own flow, can act on the real result, and
notifies ITS parent in turn (the revert chain: agent → session → workspace → global).

## Forks — settled (overnight, my calls)

1. **Vocabulary: REPORTS, not free messaging (v1).** Downward stays the existing task
   tools (send_task_to_workspace / send_task_to_session). Upward is ONE new tool:
   `report_to_requester(report)` — available on background (delegated/report) turns.
   Free-form session↔session messaging is deferred: report-shaped comms cover Chad's
   described flow and keep the graph a tree.
2. **Addressing: requester-mediated, never arbitrary.** The tool resolves the parent
   DETERMINISTICALLY from the running conversation's identity (a spawned session reports
   to its creator — its workspaceId's primary, else the global root; a workspace primary
   reports to the global root). No session ids in the tool input = no mis-addressing, no
   cycles (the creator graph is a tree; upward chains terminate at global).
3. **Awareness = a REAL TURN on the parent.** A completion/report is delivered by running
   a turn on the requester's conversation with the report as the attributed inbound
   message — through the EXISTING delegation queue (new job kind), so single-writer
   locks, FIFO, the pool cap, and the activity feed all apply for free. The parent model
   absorbs the real data in its flow and can act (forward up via the same tool, spawn
   work, or answer the user — the global root's reply reaches chat + origin channels).
4. **Loop/depth guards:** upward-only + tree topology = no cycles. A report-delivery
   turn may itself call `report_to_requester` (that IS the cascade) and may take actions
   (Chad: "they can take actions whenever they need"). The queue's caps bound fan-out.

## Shape (as built)

- **`delegation_jobs` grows a job KIND** (additive nullable column `jobKind`,
  'task' default | 'report-delivery') + `reportBody` reuse of taskText. A
  report-delivery job targets the REQUESTER conversation (workspaceId for a workspace
  primary, null for the global root) and runs a NOTIFY turn: inbound message = the
  child's report, attributed from the child (sourceLabel = session/workspace name), with
  a report-delivery steer (absorb; act if needed; report up / answer the user — never
  re-run the work).
- **Completion path change:** when a delegation job completes, the tick — instead of
  ONLY recordPushedReportMessage — enqueues the report-delivery job to the creator. The
  global-root delivery keeps channel delivery semantics (the notify turn's reply is what
  reaches the user; distill unchanged upstream of it).
- **The tool:** `report_to_requester` — POST /routing/report (x-mcp on background
  surfaces), resolves the requester from the calling scope, enqueues the same
  report-delivery job. Uncarded (it writes only into the user's own conversations).
- The old detached recordPushedReportMessage row is REPLACED by the notify turn's own
  persisted rows (the report lands as the turn's inbound message — still visible, now
  processed).

## Not in v1 (recorded)

- Arbitrary session↔session messaging · agent-level tool exposure (agents report through
  their session's turn result already) · read-receipts/threading metadata · parent
  interrupt-on-report.

## As built (2026-07-22 overnight) — decisions + deviations from the shape above

**Schema/queue.** Migration `0015_delegation_job_kind` = ONE additive
`ALTER TABLE delegation_jobs ADD job_kind text` (drizzle-verified, no recreate; NULL =
'task' for every legacy row). `enqueueReportDelivery` (orchestration) writes the only
permitted no-target rows (both targets null + kind 'report-delivery' = the global root);
column reuse per the notes plus TWO more: `workspaceName` carries the CHILD's composed
label on delivery rows ("Mark · Acme" / the session name — resolved at enqueue with the
same one-home helpers the old push used), `parentSessionId` the REPORTER's sdk session id
(provenance). `targetPrimarySessionId` is never set on a delivery row (spawned sessions
are leaves — they send reports, never receive them).

**Tick.** `runDelegationClaimAndRunTick` branches at claim: kind 'report-delivery' →
NEW `run-report-delivery-tick.ts`. Workspace requester = `delegateToWorkspaceRoot` with
two new optional variant fields (`inboundAttribution` — userSourceKind
'workspace-manager' + userSourceLabel now flow through chat's `TurnMessageAttribution`
into the inbound row — and `steerInstructions` = the new `REPORT_DELIVERY_INSTRUCTIONS`
beside `ROUTED_TASK_INSTRUCTIONS`); pool exclusion key = the requester workspaceId, so a
notify turn and a task turn on the same primary single-writer for free. Global requester
= the injected `runGlobalRootReportTurn` (apps binds `buildGlobalRootReportTurnRunner`
over `runGlobalRootTurn` — root-turn lock, routing toolset, catch-up, feed announce
'delegation' all inherited; the core gained optional `messageAttribution` +
`steerPromptAppend`, byte-identical when absent). Anti-cascade: the delivery branch NEVER
enqueues further deliveries; the parent's own "report up" is the tool inside the turn.

**Completion path.** `recordPushedReportMessage` is no longer called by the tick (the
function remains in chat — zero tick callers; sweep on next touch). The completed branch:
`completeDelegationJob` → enqueue the delivery to the creator → **stamp
`surfacedToRootAt` on the task job** (the notify turn IS the awareness path now — without
the stamp the root's next-turn catch-up would double-inject; this also FIXES the old
quirk where a workspace-spawned session's report hit the workspace conversation AND the
global catch-up). `listUnsurfacedTerminalDelegationsForUser` excludes delivery rows
entirely (their results are the parent's own replies — injecting them back would be a
false echo). A completed turn with NO text skips delivery and stays on the catch-up net.
A deleted grounding workspace falls through to the global root (tick + tool consistent).

**DEVIATION — channel delivery KEPT at task completion** (the build instruction's
"smaller safe change" fork): the distilled report still goes straight to the origin
channel when the task completes — immediate, on the already-pinned path — instead of the
notify turn's reply. The notify turn is the chat/awareness path only; its steer
explicitly forbids re-sending to channels. Revisit if Chad wants the processed reply on
channels too.

**The tool.** `report_to_requester` = POST /routing/report, body `{report: 1..50000}`
ONLY. **Requester identity = a server-stamped header** (`x-vynel-report-caller`,
`report-caller-header.ts` — the delegation-origin-header pattern):
`buildDelegatedTurnMcpComposer` wraps each routed turn's dispatcher per job
(workspace-root → workspace-primary caller; spawned target → the SESSION, via the new
`targetPrimarySessionId` on the composer input). The model never sees or supplies an id
→ CANNOT mis-address (fork 2 held all the way down). Resolution: spawned → its grounding
workspace's primary else global root; workspace → global root; no header → 400 with an
actionable "just reply with text" note. Uncarded-equivalent (mutatingApproved auto).

**DEVIATION — tool surface.** The generator gained an explicit `rootSurface: false`
opt-out (a /routing/ path escaping the root surface): the tool lands in
`generatedMcpTools` (the plain workspace array, 53 tools). Consequences, deliberate:
delegated workspace-root turns AND workspace-grounded spawned turns get it (required);
interactive workspace chats and schedule fires ALSO see it but 400 honestly (no header)
— toolset stays consistent per SDK session, which mattered more than hiding it;
**GLOBAL-grounded spawned sessions do NOT get the tool** (they attach no MCP at all —
the locked bare-forward-consistency invariant; their reports still travel via the
automatic completion delivery). The global root never sees it (routing array untouched).

**Review folds (adversarial pass, same night — all four FIXED).**
- **FIXED (must-fix) — delivery self-watch chips**: ThreadStream's received-trace
  discriminator widened to ANY attributed inbound row (`role:'user'` + non-null
  sourceKind + trace key) — covers 'global-root' task rows AND 'workspace-manager'
  delivery rows, so a notify turn's report + reply never chip a Watch at the thread's
  own turn (the 12b90bd leak class; sent-down chips survive — they hang off
  assistant rows, pinned). `attachDelegationTaskLabels` skips jobKind
  'report-delivery' rows (a report body is not a task label).
- **FIXED — completed-flipped-to-failed**: the completion write is now ONE
  `withTransaction` co-commit (complete → enqueue delivery → mark surfaced, invariant
  5 — kills the crash-between double-inject) wrapped in its own try/catch: a delivery
  enqueue failure rolls back and falls open to completing ALONE, unsurfaced (the
  catch-up net carries the report; a finished turn can never flip to failed). Pinned
  by a dedicated throwing-enqueue test.
- **FIXED — global-delivery starvation/report loss**: GLOBAL-requester delivery jobs
  share the synthetic exclusion key `GLOBAL_ROOT_DELIVERY_TARGET_KEY` (tick targetKey
  + a claim-side exclusion for both-null delivery rows when the key is busy) — at
  most ONE global notify turn runs; the rest wait as PENDING (no budget burned in
  the root-lock queue, no timed-out-delivery report loss); workspace tasks claim
  alongside, pinned.

**Open items (recorded, not built).**
- A failed notify turn loses the root-catch-up net for that report (the task was
  already stamped surfaced); the full report stays on the task job row + trace, and
  the failed delivery row is visible. Revisit if it bites.
- The GLOBAL notify turn has no Stop interrupt reach (flag-only stop at terminal time).
- The workspace notify turn records a reporter→requester `recordDelegation` edge
  (faithful runner reuse) — monitor-tree semantics for that edge are a later-arc call.
- `recordPushedReportMessage` now has zero production callers — delete on next touch.
- In-flight chips: delivery jobs appear in `listInFlightDelegationsForUser` (real
  activity; label = the child's name) — acceptable v1, watch for confusing banner copy.
