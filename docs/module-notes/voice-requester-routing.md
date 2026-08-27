# Voice requester routing — module notes + plan

*Opened 2026-08-27 from Kafi's report: the VOICE thread sent a task, and the task's report came
back on the GLOBAL conversation instead of the voice thread. Review confirmed the mechanism; this
doc is the findings, the plan, and the verification Kafi asked for (can a workspace child's report
land on the global root the same way?).*

---

## 1. The findings (root cause, verified 2026-08-27)

The requester model is **binary** everywhere a report is addressed — a conversation is either a
workspace primary or the global root; nothing else can be asked *for* work:

- `resolveTaskSender` (`apps/local-api/src/routes/routing/dispatch-message.ts`) resolves the
  sender from `callingWorkspaceId` alone. A VOICE turn sends with no workspace, so it is treated
  as **a global-root send**: the job's `parentSessionId` is stamped with the GLOBAL brain's
  segment (wrong provenance — the voice thread never appears), and no requester is recorded. If
  the global brain has never run, the voice send even fails with "Routing is only available
  during an active global-root turn" — a lie on an active voice thread.
- `ReportDeliveryRequester` (`packages/orchestration/src/routing/enqueue-report-delivery.ts`) is
  `workspace-primary | global-root`. Its header comment still says "spawned sessions are leaves —
  they send reports, they never receive them"; true before the voice thread existed, false now.
- All three report doors resolve `null requester → global root`: `resolveJobReportRequester`
  (auto-report + failure push), `resolveUpwardSender` (a child's own `send_message` report /
  update / direct), and `runReportDeliveryJob`'s two-branch delivery (`workspaceId === null` →
  the global notify runner or a direct persist onto the GLOBAL transcript).

So every report of voice-created work lands on the global brain. The voice thread never hears it.

## 2. The verification (workspace children — Kafi's question)

A **workspace-grounded** child's report does NOT fall to the global root under the same criteria:
`resolveUpwardSender` falls back to the child's grounding workspace, and task sends from a
workspace surface stamp `requesterWorkspaceId`, so reports land on the workspace MANAGER's chat.
Global root receives a child's report only when: (a) the child is global-grounded (the root's own
sessions — correct; the voice thread's sessions — the same bug, fixed by this arc, since a voice
task can only target global-grounded sessions per the own-child rule); (b) the requester
workspace was deleted (deliberate failover); (c) legacy rows with nothing stamped.

Two **deliberate, documented** asymmetries were re-confirmed, not changed (both need a product
decision with Chad before touching): a root-tasked workspace-grounded session reports into its
workspace's chat, not back to the root (the in-code "job-level asked-by-the-root marker" note);
and session→sibling tasks report to the shared manager, not the asking session (Chad's one-rule
call, 2026-08-16: reports terminate at managers).

## 3. The fix (no schema change)

The job row already carries everything needed — `parentSessionId` IS "the asking conversation's
segment at enqueue", and the voice bug is that it is stamped with the WRONG segment. Fix the
stamp, then derive the requester from the segment's scope (the `dispatch-note.ts` voice-sender
precedent). Delivery rows address the voice thread through the existing (delivery-unused)
`targetPrimarySessionId` column. No migration.

1. **Sender** — `resolveTaskSender`: no calling workspace + the ambient turn-session header's
   segment is scope `'voice'` (owned) → creator = the voice primary
   (`findVoicePrimarySessionForUser`); `parentSessionId` = its current segment. Requester
   resolution keys off this stamp.
2. **One home for the derivation** — `resolveVoiceRequesterOfJob(db, job)` in
   `packages/session/src/delegation/`: `requesterWorkspaceId === null` AND the job's parent
   segment is an owned scope-`'voice'` row → the user's live voice primary. Consumed by
   `resolveJobReportRequester` and (via the ambient running-job header) `resolveUpwardSender`.
3. **Requester shape** — `ReportDeliveryRequester` gains `{ kind: 'voice';
   voicePrimarySessionId }`; the delivery enqueue ops write it as
   `targetPrimarySessionId` (workspace columns stay null). The claim tick already keys the pool
   on `targetPrimarySessionId ?? workspaceId ?? global-key`, so voice deliveries get their own
   FIFO lane for free.
4. **Delivery** — `runReportDeliveryJob`: a delivery row with `workspaceId === null` and
   `targetPrimarySessionId` set is a VOICE delivery (verified against the live voice primary;
   corrupt rows fall back to global with a warn). Busy-yield checks
   `rootTurnLockKey(userId, true)`; the notify turn runs the injected runner with
   `thread: 'voice'`. **As-built refinement:** voice direct/mention-chain deliveries do NOT
   transcript-persist — the voice thread has no absorb net (no catch-up runs on it), so a
   persist would leave the spoken model blind to a reply the user can see. They run the notify
   turn under the DIRECT steer instead (the workspace requester's exact fallback shape).
5. **Runner** — `runGlobalRootTurn` gains `thread?: 'voice'`: `resolveVoiceConversationTarget`,
   `voice: true` into the core (which already owns the voice lock lane, voice-base instructions,
   and the hidden `Voice conversation` segment presentation), the voice TIER settings pin (D2,
   via `resolveInteractiveTurnSettings`), `withVoiceThreadToolDenials` (no `speak` — the thread's
   text is its voice), no ask descriptor, feed `scopeKind: 'voice'`.
6. **Mentions** — a voice-turn `@persona` mention's agent-run row already stamps the running
   (voice) segment as its parent (`composer-mention-turn.ts` enqueues on `onSessionResolved`),
   so the colleague's reply resolves back to the voice thread through the same derivation —
   zero changes needed.
7. **The global catch-up excludes voice-asked outcomes** (as-built): the root-awareness
   collector (`collectDelegationReportsForRoot`) takes a `belongsToRoot` predicate;
   `composeGlobalRootProviderMessage` passes the voice derivation, so a voice-asked failed or
   direct row is never narrated into the global brain ("wrong room"), while its id still rides
   the surfaced-latch and retires from the scan. The voice thread needs no catch-up net of its
   own precisely because every voice delivery — direct included — runs as a real turn on it.

## 4. Deferred (recorded, not built)

- **Speaking an arriving report aloud on a live call** — the notify turn lands text in the voice
  transcript; the daemon only voices live turn streams. Parked with the voice-daemon slice
  (the voice auto-continue deferral's sibling).
- **Notes TO the voice thread** — still not a routable note target ("no reply address").
- **Nodes-screen edges** — `list-recent-message-edges` reads `requesterWorkspaceId`, so a voice
  sender renders as a global edge. Cosmetic.
- **The asked-by-the-root marker / session-as-requester generalization** — the two documented
  asymmetries in §2; product decision with Chad first.

## 5. Verification

- Gate: targeted typecheck + vitest per move; full `pnpm test` at the end (Kafi runs it at
  integration points).
- Live smoke (Kafi): from the voice surface, send a task to a workspace → the report arrives in
  the VOICE conversation (and is absent from the global chat); same for a `direct_to_user`
  answer; a global-chat task still reports to the global conversation unchanged.
