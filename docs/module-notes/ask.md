# Ask — module notes

**Status:** design agreed 2026-07-17 (forks answered, see "Chad's fork answers") · net-new leaf
(arc ② of Tasks → Ask → Apps → SSH).

## Chad's advice (the why)

- Claude needs a way to **ask users for inputs** mid-work. Free-text questions in chat are how
  developers talk; non-technical people fill **forms**.
- Rendered as a **wizard — one question per step** — with a **switch to see the full form** on
  one page. Get the inputs, work accordingly.
- Downstream payoff: Apps ("which app should I run?") and SSH ("what's your server address?")
  are built assuming Ask exists.

## Shape

### The blocking bridge (the heart)

`ask_user` is a tool that BLOCKS the running turn until the user answers — exactly the approval
card's await-a-resolution pattern, with richer payloads:

1. The tool handler validates the questions, inserts a `pending` `ask_requests` row, and awaits
   an in-process **waiter registry** (Map<askId, resolve> in local-api — same process as the
   in-process MCP server, so no polling loop inside the handler).
2. The UI learns about it the way it learns about approvals (poll/SSE — mirror whatever
   ApprovalNotifier does today), renders the wizard, and submits answers.
3. `POST /asks/:id/answer` marks the row `answered` + resolves the waiter → the tool returns
   `{ answered: true, answers }` and the turn continues.
4. **Dismiss resolves cleanly** (`{ answered: false, reason: 'dismissed' }`); there is NO
   auto-timeout (Chad: a decision Claude asked for can't be fabricated) — the ask waits as long
   as the turn lives, and boot recovery expires zombies whose process died.

Ask ships its OWN `McpFeatureDescriptor` (the notebook precedent) — the tool is not
route-derived (a generated route tool can't own an await). `contributePrompt` teaches WHEN to
ask: only when genuinely blocked on the user's preference/data, a few related questions at once
(one wizard, not five), plain-language labels, never re-ask what memory already knows.

### Leaf: `packages/asks`

`ask_requests` table: id · userId · nullable workspaceId (NULL = global) · sessionId loose ref ·
`questions` JSON (validated against the contracts schema) · `answers` JSON nullable · status
`pending | answered | dismissed | expired` (expired = boot recovery found the awaiting process
dead) · createdAt / resolvedAt. Outbox events: `ask.created` / `ask.resolved`. Hard delete via
purge only (an answered ask is transient plumbing, not user content — mirror approvals'
retention/purge approach).

**Question contract** (`@vynel/contracts/asks/ask-questions`): `{ id, label, hint?, type,
required?, options?, placeholder? }` with `type: 'text' | 'choice' | 'multi-choice' | 'yes-no'
| 'number'`; ≤10 questions per ask; label/option length caps. Answers validate against the
question set at the boundary (a `choice` answer must be one of its options, etc.).

### Routes

User-scoped `/asks` only (the answering surface is always the user):
GET `/asks/pending` [UI poll] · POST `/asks/:id/answer` · POST `/asks/:id/dismiss`.
No x-mcp on any of these (the agent's surface is the descriptor tool, never the routes).
Not featureGated (Ask is core interaction plumbing, like approvals).

### UI

- Pending ask surfaces like a pending approval (notifier + a card in the active chat view).
- Opening it = a Modal wizard: one question per step, progress dots, Back/Next, Submit on the
  last step — and the **"View as form"** switch showing every question on one page (same
  component set, two layouts). Built on the `Modal` primitive.
- Dismiss is always available ("I'll decide later") and tells Claude so.

### Capability

`asks` in the catalog? NO — Ask is not a per-workspace capability like memory/knowledge; it's
core interaction plumbing (like approvals). No toggle in v1; the user's control is answering,
dismissing, or ignoring (timeout).

## Chad's fork answers (2026-07-17)

1. **NO auto-timeout — an ask WAITS for the user.** "Without user recommendation it can't
   continue if it requires a decision" — Claude must never fabricate an answer to a question it
   chose to ask. The tool awaits as long as the turn lives. The user's explicit **dismiss** is
   the only "proceed without me" path (`{ answered: false, reason: 'dismissed' }`).
   Consequences:
   - **Telegram nudge:** when an ask goes pending, notify the user through their connected
     channel — an outbox consumer in the channels leaf on `ask.created` (the
     schedule.run-completed delivery precedent) sends "Claude needs your input: <first
     question label> — open the app to answer." Nudge only; answering stays in the app (v1).
   - **Boot recovery:** a pending ask whose awaiting process died is unanswerable — on boot,
     mark stale pending rows `expired` (the approvals recover precedent) so the UI never shows
     a zombie wizard.
   *Revised by the session-hardening arc (2026-08-19, decision D5):* interactive asks now carry
   a GENEROUS bound — `VYNEL_INTERACTIVE_ASK_MAX_MS` (2 h) on the descriptor — plus a 60 s
   reaper (`asks-recovery-service`) for rows whose waiter died. A decision Claude asked for is
   still never fabricated quickly; but a form the user walked away from must not hold the
   thread's single-writer lock for the process lifetime. A parked ask suspends the owning
   turn's wall clock. `ask_user` is NOT attached on the voice thread (the model asks in
   speech).
2. **App turns only in v1** — headless turns (schedule fires, channel inbound) don't get the
   tool; the prompt tells Claude to use sensible defaults there. Channel Q&A is a later arc.
   *Revised by the tool-policy arc (2026-08-14):* channel turns now DO attach `ask_user` with a
   bounded `timeoutMs` (10 min — the approvals-reaper bound); an unanswered form resolves
   `expired` and the turn proceeds on judgment. The Telegram nudge makes the unattended ask
   answerable; answering still happens in the app. Schedule/delegated turns stay ask-free
   (deferred — needs the turnKey lifecycle threaded through the session leaf).
3. **Notifier + Modal wizard** (one question per step + "View as form" switch).

## As-built notes (2026-07-17)

- **`@vynel/asks` barrel split:** the main barrel is SDK-free (routes import ops statically);
  the descriptor lives on the `@vynel/asks/mcp` subpath the turn streams dynamic-import (the
  keep-the-SDK-out-of-module-load pattern).
- **The registry is DI'd** through `createApp({ askWaiters })` → `c.var.askWaiters` (one per
  process, like fileWatcher) — route tests park/resolve waiters around real HTTP calls.
- **Boot recovery** runs in `server.ts` beside the approvals reaper; **scope cancel** runs in
  BOTH interactive streams' `finally` (chat-turn + global-root-turn).
- **Found + fixed a pre-existing divergence:** workspace turns (chat + schedule fires) DROPPED
  the MCP composer's `systemPromptAppend` — the notebook's standing line never reached them;
  only the global-root stream passed it. Both sites now join the capability prompt with the MCP
  prompt sections; `FireScheduleDeps.composeWorkspaceMcpServers` gained `systemPromptAppend`.
- **Telegram nudge DEFERRED (its own slice):** the generic outbox relay (`dispatchOutboxEvents`
  + `OUTBOX_CONSUMERS`) exists but is WIRED NOWHERE — no service drives it, the registry is
  empty (so the schedules→channels delivery consumer is dormant too). A nudge consumer would be
  dead code until the relay is wired; doing that activates dormant machinery and deserves its
  own reviewed slice. `ask.created` already carries everything the nudge needs
  (firstQuestionLabel + questionCount).

## Deferred (deliberate)

- **The Telegram nudge + wiring the outbox relay** (see as-built note above) — next slice
  candidate; benefits schedules delivery too.
- ~~**`ask_requests.sessionId` is stored-but-unpopulated**~~ *Closed by the tool-policy arc
  (2026-08-14):* the compose contexts now pass Vynel's stable primary-session id and the tool
  stamps it on the row (a loose ref, no FK). Turn-end cleanup still keys on the per-turn
  `turnKey` (reviewer S2 — two concurrent same-workspace turns can never cancel each other's
  asks).
- Channel delivery of the Q&A itself (Telegram sequential questions, voice read-aloud) — the
  contract is channel-agnostic so this bolts on later.
- File-picker / date question types.
- Multiple concurrent asks UX polish (v1: newest first, one wizard at a time).

## Build order (gate-green at each step)

1. Contracts (question/answer schemas) + leaf (table, migration 0007, repos, ops incl. the
   resolve path, events, tests).
2. Waiter registry + descriptor (`ask_user` tool, no timeout, dismiss-resolvable) + attach at
   the interactive turn points only + spec tests.
3. Routes (pending/answer/dismiss) + SDK regen + route tests.
4. UI (notifier surface + wizard Modal + full-form switch) + tests.
5. Prompt line + module-notes as-built → full gate → reviewer → commit.
