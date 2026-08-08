# Live tracking — redesign spec (Chad's case-by-case instructions)

**Status:** RECEIVING (2026-08-08). Chad is redesigning live tracking case by case after the wh
review (`docs/live-tracking-wh.md`, bugs/gaps IDs there). Principle behind every case:
**tracking = navigation, not mirroring** — surfaces point at the real conversation instead of
re-rendering it through correlation joins.

**The definition (Chad, 2026-08-08, verbatim intent):** *"tracking means: pointer — click will
scroll to where the partial id is."* A primary session continues across multiple tasks and fans
out via spawned sessions; the pointer per task is the entire tracker. Each case lands here verbatim-intent first, then the
mechanics mapping. Nothing is built until the cases are complete and Chad okays the arc.

---

## Case 1 — Global → Workspace (received 2026-08-08, with mock screenshots)

### Chad's instruction (intent)

The live tracker for a workspace doing a task from global is a **pointer**, not an inline card:

1. The inline chip/card row in the global thread ("Noah · Invoices · July invoicing — working…")
   is REMOVED (marked ✗✗ on the mock).
2. A slim **right-edge working rail** shows one workspace monogram per workspace currently doing
   work from global (mock: "IN", "MA" under a vertical "WORKING" label; "MA" carries a dot).
3. Clicking a rail icon opens a **right sidebar** = that workspace's REAL chat:
   - **One unified flow** — messages + tool chips inline. NO Activity/Chat tab split
     ("we don't need separate tab like activity and chat, only total chat").
   - Header: workspace name + persona · task label · elapsed (mock: "Marketing site /
     Mia · Newsletter draft · 32m 5s").
   - Approval banner when waiting ("Waiting on you — approve `npm run deploy`").
   - Composer messages the persona directly ("Message Mia…").
   - Footer actions: **Open session** (jump to the full workspace tab) + **Pause**.
4. Entry behaviors:
   - Rail icon clicked directly → sidebar at the LATEST messages ("like normal chat").
   - **Pointer on a global message** (the hand-off row for that ask) → sidebar shows all
     messages but NAVIGATES/anchors to where that ask STARTED in the workspace thread.

### Why this is simpler (assessment)

The entire per-card correlation layer disappears for this surface: no delegation↔turn pairing, no
acked-badge threadId matching, no per-task card keys, no narration mirroring. The sidebar renders
persisted rows + the existing live overlay (both verified sound in the review). Tracking needs
exactly TWO facts, both simple and durable:

1. **Which workspaces have in-flight global work** → the rail. Sources already exist (in-flight
   delegations poll + feed presence per workspace).
2. **Where did this ask start** → the anchor. ONE durable pointer per task:
   `task → (workspaceId, originMessageId)` — the routed-task row the dispatch records into the
   workspace thread IS the anchor; stamp its id on the job at dispatch time. No reconstruction,
   no joins, refresh-proof by construction.

Bug-class impact (IDs from `docs/live-tracking-wh.md`):
- **B7** (ghost delivery cards) — moot in the thread: no inline cards to ghost. Rail keys on
  work-kind jobs only (the query fix still applies).
- **B6** (cards narrate blank) — moot: the sidebar shows the REAL tool rows, which already
  persist per chunk; no feed-step mirroring needed for this surface.
- **B8** (blank replay) — blast radius shrinks to the rail dot/header line only.
- The positional card-key fallback, acked `'global-root'` exclusion, and per-surface scoping
  rules (`onlyWorkspaceId`) all stop mattering here.

### What it reuses (verified sound in the review)

- Thread renderer with inline tool chips (the workspace thread already renders exactly the
  unified view the sidebar needs).
- The watched-turn registry (session watch, re-attaches across turns) for the sidebar's live
  edge; 4s fallback poll behind it.
- Queued mid-turn sends (the composer's direct message rides the existing send/queue path —
  NOTE: this is the workspace PRIMARY, so direct send is the normal workspace turn; the B3
  workspace-lock fix becomes REQUIRED here, since sidebar sends while a delegation runs are
  exactly the two-writers hole).
- Pending-approvals read for the banner; stop path for Pause.

### Defaults — CONFIRMED by Chad (2026-08-08 follow-up)

- **D1 CONFIRMED — the pointer:** immediately after the hand-off, the global thread shows a
  pointer element: "<task description> → Workspace A". Clicking it opens the sidebar anchored
  at where the task started. From there the user can jump to latest, scroll below, and message.
- **D2 CONFIRMED — the rail:** ONLY active workspaces show an icon; idle = gone.
- **D3 SIMPLIFIED (Chad's mechanic — no new schema):** the anchor key is the existing
  **`partialSessionId`** — already on the job row AND stamped on the routed-task row written
  into the target thread (verified: `dispatch-message` inserts the inbound row with
  `partialSessionId` attribution). Pointer → find the row carrying that key in the target
  thread → scroll + highlight. Durable by construction (persisted rows), zero new columns.

### Edge notes (recorded)

- **Queued task, no anchor yet:** the inbound row is written when the routed TURN runs — while
  the job is still pending there is no row to anchor. Pointer then opens the sidebar at latest
  (header can say "Queued"). Self-heals the moment the turn starts.
- **Keyless jobs** (`partialSessionId` null — rare, Ch2-precluded): pointer falls back to
  open-at-latest.
- **Retries:** the job keeps its `partialSessionId` across attempts, so the anchor is stable.

---

## Case 2 — Workspace → Session (received 2026-08-08, same message)

**Chad's instruction:** "If workspace sent task to a session it will have partial session id for
navigation in same way."

Same pattern, one level down: the workspace's hand-off row (in the workspace thread) carries the
pointer "<task description> → Session S"; the hop's own `partialSessionId` anchors navigation
into the SESSION's conversation at the task's start. The chain is navigated hop by hop —
consistent with the locked watch-one-level-down rule, now as pointer-one-level-down.

### Proposed defaults (awaiting Chad)

- **D4 — in-sidebar drill:** clicking a pointer INSIDE the sidebar (workspace → session) makes
  the same sidebar navigate to the session's conversation, with Back returning to the workspace
  chat (the stacking pattern already locked for the old panel in B6).
- **D5 — SUPERSEDED (2026-08-08):** the rail is NOT workspaces-only — see "The rail —
  clarified" below. Every active working entity gets its own icon.

---

## Case 3 — @mentions, colleagues, and ephemeral agents (received 2026-08-08)

### Chad's instruction (intent)

1. **A mention is a DIRECT message.** @mentioning an agent means its colleague session receives
   the user's message directly (not a re-worded task). Inside the colleague's thread the row is
   attributed **"You (Me) — from Global"** (or "from <Workspace>" when mentioned there).
2. **The colleague replies via `send_message`** — to the user (the originating chat) or to
   claude/a session. In the origin thread the reply renders as a **pointer-kind compact box:
   short title + description; clicking pops the description up as the report.**
3. **Single answer → NO tracker.** A quick Q&A is just the mention row + the reply row. A TASK
   gets the same pointer tracking as Cases 1–2 — the hop's `partialSessionId` navigates to
   where it started.
4. **Every configured agent (`.claude/agents`) gets a colleague session — all session kinds
   follow the SAME process** — so they carry context (continuity/memory) and full capabilities.
   Scope follows the mention location: mentioned at global → its GLOBAL colleague session;
   mentioned inside a workspace → its colleague session IN that workspace. (Matches the shipped
   colleague model: one continuing session per user + scope + agent.)
5. **Ephemeral SDK subagents** (the default Agent tool spawning dynamic one-time agents) —
   CORRECTED 2026-08-08: they DO get a rail icon while running AND a pointer; click → sidebar
   showing **ALL their one-time activity** (no anchor navigation — nothing to navigate; no
   composer — you don't message a one-time worker). The activity stays viewable persistently
   after completion. What separates them from session-kind entities is the COMMUNICATION
   model: **they never talk** (no ack/update/report lifecycle) — they **RETURN** their result
   to the spawning turn as the Agent tool's return value.
6. **Mention topology:** inside a workspace you can NOT @mention another workspace.
   Cross-workspace context rides **#refs** ("follow that workspace's coding pattern") —
   read-only pointers, no tracker.

### Mechanics mapping

- Direct-message mentions = the shipped A4 path (mention resumes the colleague, serialized on
  its lock) — the DELTA is presentation: the colleague thread renders the inbound row as
  "You · from <origin scope>" (user-authored, origin-labeled), not as a system/task row. The
  `deriveMessageOrigin` vocabulary + threadId already carry what's needed; the sourceKind
  widening (report SHOULD-FIX: `'agent'` instead of blanket `'workspace-manager'`) aligns.
- Reports-as-popup = the locked "compact incoming boxes opening like plan cards" decision,
  simplified: visible = title + short description; popup = the full report body.
- Ephemeral agents: current behavior already matches (tool card + persisted fields + focus
  view); no rail, no feed dependence.

### Proposed defaults (awaiting Chad)

- **D6 — no answer-vs-task classification needed:** trackers are **in-flight-only by nature**.
  The pointer/live affordance exists only while the run is in flight; a single-answer run
  settles in seconds, so it effectively never shows a tracker — no upfront "is this a task?"
  decision by anyone. Long runs keep their pointer exactly as Cases 1–2.
- **D7 — CONFIRMED by Chad ("yes same process"):** the sidebar composer works for colleague
  sessions too — same direct-message semantics as a mention. The recorded deferral **G5**
  (colleague direct-send route + `SessionTargetLocks` + MCP-set parity) is now IN this arc as a
  hard requirement.

### Implementation checks recorded for the arc

- Verify workspace mention rosters cannot @ another workspace today (grammar/roster
  composition) — enforce if not.
- Colleague inbound-row attribution ("You · from Global") vs today's stamped rows — rendering
  change in the colleague thread view.
- `send_message` "to user" = delivery to the originating chat surface (exists — T3
  report-to-originating-chat); confirm the compact title+description shape end-to-end.

---

## The rail — clarified (Chad, 2026-08-08; applies across all cases)

**"Agents, session, workspace ALL will show as small icons"** on the right-edge rail while
active. Per entity:

- One small icon per active working entity — a workspace, a spawned session, an agent
  colleague — monogram or persona image (resolve-persona already supplies both).
- **One icon per entity regardless of task count (Chad CONFIRMED):** a workspace with five
  tasks still shows once; the icon leaves only when nothing of its work remains active.
- **Icon typing (Chad):** a workspace shows its workspace icon; an AGENT entity wears a small
  agent badge on the icon's corner (top-left or top-right) so agents and workspaces read
  differently at a glance. (Spawned sessions: persona monogram — micro-default, correct if
  wanted.)
- Click → the sidebar opens that entity's REAL conversation; the pointer navigates to the
  partial area (the `partialSessionId` anchor) where the current work started.
- **Completion removes the icon** — "once they complete, one after another they're gone from
  the right side." The rail is strictly what's active NOW.
- **Built-in ephemeral agents rail too (CORRECTED 2026-08-08):** icon while running + pointer;
  click → sidebar showing ALL their one-time activity (read-only, no anchor navigation,
  persists after completion). They differ in the communication model only: they RETURN results
  to their spawning turn, never send lifecycle messages.
- Rail-source note for ephemeral agents: they have no `delegation_jobs` row and no
  `session_turns` envelope of their own — their running state = the Agent tool call's status
  (`'started'`) on the parent turn: durable via `chat_tool_calls`, live via the fold's
  `agentActivity` map. The rail builder needs this as its third source.

Mechanics note: the rail's roster is exactly the grouping the old Background overview computed
(`targetPrimarySessionId` → session/colleague · `ws:<id>` → workspace · in-flight jobs + feed
presence) — reuse the pure builder (`buildBackgroundActivity`-style), render as icons instead of
a panel. Observation (awaiting Chad's explicit case): the rail + sidebars absorb the Background
overview's whole job; the old panel, Home band, and title-bar button likely reduce or retire.

Open micro-details (defaults proposed): rail order = start order (stable, insertion); many
actives → vertical scroll within the rail; attention dot per icon (approval waiting) per D2.

### Q7 — SETTLED (Chad, 2026-08-08; examples in `docs/live-tracking-example.md`)

- **Q7a** — Background overview panel RETIRES. **No per-task strip** (Chad's amendment): the
  sidebar shows the regular conversation ONLY; multiple tasks are visible as pointer rows in
  the flow. Children push messages at natural breaks (after a tool completes); the entity
  absorbs context and processes when it needs — the conversation IS the realtime view.
- **Q7b** — the monitor overlay (trace / session / agent nodes, the derived trace view)
  RETIRES entirely; pointers into real conversations replace it.
- **Q7c** — Home's "Right now" band RETIRES. **No status-line replacement either (Chad):
  Home is being rebuilt later — this arc touches nothing on Home beyond deleting the band.**
- **Q7d** — title-bar presence: KEEP the passive dot (gold/amber/grey), RETIRE the button.
- **Edge case** — the brain rails like everything else: a background global-root turn
  (channel reply, schedule fire) shows a `[CL]` icon from any tab; click → the Global thread.
- Multi-task-in-one-sidebar: RESOLVED by the Q7a amendment (no special presentation).

**Final chrome:** the rail + the sidebar + a passive title-bar dot. (Home: nothing in this
arc — it is rebuilt later.)

---

## The arc plan (proposed — awaiting Chad's okay)

### B-item dispositions under the redesign

- **STAY (prerequisites + backbone):** **B3** workspace target lock — HARD prereq (the sidebar
  composer sends into a workspace primary while delegations run) · **B1 + B2** delivery
  guarantees (report loss on restart; `reportedAt`) · **B4** mid-turn swap chain repair
  (pointers + chain-follow need whole chains; anchor rows live on segments) · **B5** monitor
  watermark paging · **B7's QUERY half** (work-kind filter via the `isWorkJobKind` one-home —
  the ghost-CARD half dies with the cards).
- **MOOTED by the redesign (record, don't fix):** **B6** — no narration surface remains
  (cards, roster, Home band all die; sidebars show real rows) · **B8** — the narration replay
  has no consumer left (presence replay is already correct) · **B9** — the pane dies; the
  sidebar's liveness reads the presence store from day one.

### Phases (one move at a time; targeted green + review per move)

- **Phase 0 — backbone (pure backend, UI-independent):** B3 → B1+B2 → B4 → B5 + B7-query.
- **Phase 1 — the pointer:** anchor read (row by `partialSessionId` in the target thread) +
  attribution labels (`YOU · FROM <scope>` / `CLAUDE · FROM <scope>`) + the pointer-row
  component replacing the delegation chips.
  **SHIPPED 2026-08-08** — PointerRow + `buildThreadPointers` one-home + ThreadStream
  matching through the dispatch tool call's served `delegation` key (reviewer catch:
  sender-side message rows are unstamped in production — the tool-call DTO carries the work
  key); mention inbound rows stamp `'user'` + origin-scope label ("You · from Global");
  routed-task rows render "Claude · from <label>" when labeled, scope-silent "Claude"
  otherwise. DEFERRED INTO PHASE 2 (deliberate, reviewer-flagged): ① stamp the mention
  message's own `partialSessionId` sender-side so @mention hand-offs grow pointers too;
  ② stamp `userSourceLabel` on the routed-task delegate paths (workspace-root / spawned /
  tick session-target) so anchor rows carry their true origin scope; ③ add `'user'` to the
  acked-detector exclusion when colleague threads gain cards/sidebars.
- **Phase 2 — the sidebar:** persistent right panel with back-stack hosting the unified
  conversation (scroll-to-anchor + highlight, composer with queued sends, Open session,
  Pause; the ephemeral-agent all-activity view) + **G5 colleague direct-send** (D7: route
  widening + MCP-set parity + `SessionTargetLocks`).
  **SHIPPED 2026-08-08** (`a02bb05` G5 · `365c026` mention anchors + origin labels ·
  `d5ec27b` ConversationSidebar (session + workspace nodes, anchor landing + gold flash) ·
  `1b9846d` review fixes (SDK parity, mount-scroll race, one-home opener) · `5900afe`
  WorkspaceSidebarThread with a REAL composer + the B3 queued sentinel surfaced).
  Deferred, recorded: in-sidebar pointer rows (the D4 push drill — store semantics pinned);
  Open-session/Pause footer actions; ephemeral-agent sidebar view (tool card carries it).
- **Phase 3 — the rail:** entity roster (feed presence + work-kind in-flight jobs + running
  Agent tool calls + the brain), icon typing (workspace icon / agent corner badge / session
  monogram), attention dots, start-order, scroll.
  **SHIPPED 2026-08-08 `dc27e81`** — `buildRailEntities` (pure, tested) from feed presence +
  the work-kind poll; one icon per entity; colleague corner badge (`jobKind` now on the
  DTO); workspace attention dot from pending approvals; the brain rails for NON-web
  background turns; gold breathing ring = working; click → the sidebar (segment → workspace
  → trace fallback). Deferred, recorded: ephemeral-agent rail icons (needs a running-agent-
  calls read); per-session attention dots.
- **Phase 4 — the deletions + polish:** cards, chips, acked joins, pairing-in-threads,
  narration consumers, ActivityMonitorPanel + trace view + AgentFocusView, Background
  overview, Home band (no replacement — Home rebuilds later), title-bar button (→ passive
  dot), watch chips; then
  docs + CHANGELOG + full `pnpm test` gate + Chad's smoke list.

---

## Post-smoke tweak 1 — direct mention replies (Chad, 2026-08-08; SHIPPED)

**Instruction:** an @mention's reply is a DIRECT response to the user — show it directly
(the kind already renders the box); the global session must KNOW it but never REPEAT it.

**Shipped shape:** a global-requester delivery whose chain's work job is an `agent-run`
skips the notify turn entirely — `recordDirectReplyMessage` persists the reply straight
onto the root's transcript (inbound `agent` row, marker + chain keys; a momentary feed
announce lands it live in every open window), the delivery completes turn-free (faster:
no root-lock wait), and the mention run stays UNSURFACED so the widened catch-up net
(work kinds) injects it into the NEXT root turn marked "already replied DIRECTLY — absorb
silently, do NOT restate"; a colleague that finished without speaking injects honestly.
Claude-commissioned task reports keep the narrated relay (deliberate contrast).

**Recorded follow-ups:** ① workspace-origin mentions still narrate via the workspace
notify turn — the direct persist needs a workspace-side recorder twin; ② the old
`recordPushedReportMessage` remains caller-free — delete on next touch.

---

## Post-smoke tweak 2 — kind `direct_to_user` (Chad, 2026-08-08; SHIPPED)

**Instruction:** extend the direct path the easy way — keep kind `report` (fine, Claude
reads it), add kind `direct_to_user`: whatever is messaged with a title shows as a normal
message; Claude acknowledges but stays silent.

**Shipped shape (sender-declared intent, no more chain inference as the only door):**

- **The tool:** `send_message` gained `kind: "direct_to_user"` + a required short `title`
  (400 without it; 400 for a title on any other kind or a downward direct). The tool text
  steers: direct_to_user when the USER should read the answer itself; report when the
  requester acts on it. One final report/direct per task — direct marks the running job
  reported exactly like a report.
- **The queue:** the dispatcher enqueues jobKind `'direct-delivery'` (third member of
  `DELIVERY_JOB_KINDS` — every claim/requeue/settle/in-flight predicate picked it up via
  the one-homes). The stored body is `title\n\nbody`, so the compact box's teaser IS the
  title and the popup shows the full text — no new columns, no migration.
- **The delivery:** the tick's direct branch now fires on `direct-delivery` kind OR a
  mention chain (the shipped floor stays: a mentioned colleague delivers direct whatever
  kind it spoke). Global requester → `recordDirectReplyMessage` onto the root transcript
  under the new `[Message from …]` marker; no notify turn. WORKSPACE requester → falls
  back to the notify machinery under a new DIRECT steer (absorb, don't narrate) — honest
  interim until a workspace absorb-net exists.
- **Claude knows, silently:** invariant 5 gained the direct exception — a task whose
  final answer went direct completes UNSURFACED (the co-commit skips the mark; same for
  the timed-out-after-reported branch, and the agent-run timeout no longer suppresses),
  and the collector presents any REPORTED task reaching the net as "already sent its
  result DIRECTLY to the user … absorb silently, do NOT restate".
- **The UI:** the box badge reads **Message** (vs Report/Update) off the marker; the door
  says "View message"; the dialog titles "Message from X". Teaser = the sender's title.

**Verified:** typecheck 72/72 packages (forced); 283 tests green across contracts /
orchestration / session-delegation / routing routes / MessageRow (new pins: marker
round-trip, enqueue kind flip, tick direct e2e global + workspace-fallback steer,
claim-tick UNSURFACED completion either claim order, collector absorb line, route 400s,
Message badge + door kind); MCP/SDK/port parity all OK.

**Recorded follow-ups:** ① the workspace-requester direct fallback still runs a (quiet)
notify turn — a true workspace-side direct persist needs the recorder twin + a workspace
absorb-net; ② steer decay watch: colleagues choosing report-vs-direct rides the tool
description — if smokes show reports where directs belong, move the nudge into the
delegated-turn task steer.

---

## Post-smoke tweak 3 — pointers persist; the dispatch chip retires (Chad, 2026-08-09; SHIPPED)

**Instruction:** the gold delegation chip under the send tool call goes — the pointer below
it is the tracker; and the pointer STAYS after completion: running indicates running,
complete stays in a completed state.

**Shipped shape:**

- **Chip retired:** ToolCallList renders nothing under a dispatch card — the chip's
  `openDelegation` emit had no listener left (dead door since the redesign); its tests are
  replaced by a no-chip pin.
- **Pointers persist:** the pointer's base is now the dispatch tool call's served
  `delegation` payload (permanent), with the in-flight poll only OVERLAYING live state
  (fresher status + persona-enriched labels). Settled mapping: completed → "done", failed
  → "failed" (--danger; gold stays presence-only). Still clickable — the payload gained
  `workspaceId` + `targetSessionId` (current segment, serve-time resolved) so the sidebar
  route works after the poll stops carrying the job. Delivery hops (null taskLabel) and
  received-side rows still never grow pointers; mention ROW-key pointers stay live-only
  (the colleague's reply box is the settled record).
- **D6 revised:** "trackers are in-flight-only" no longer holds for tool-call pointers.

**Verified:** typecheck 45/45 forced (post SDK regen — `DelegationToolOutcomeSchema` gained
the two fields); 50 tests green across ToolCallList (no-chip pin), thread-pointers
(`buildToolCallPointer` status mapping + delivery-hop null), thread-stream (settled pointer
renders + clicks from an EMPTY live map), attach-delegation-tool-outcomes (segment
resolution); SDK/MCP/port parity OK.

---

## Post-smoke tweak 4 — colleague messages are regular messages (Chad, 2026-08-09; SHIPPED)

**Instruction:** the left accent border + View chip made a colleague's delivered message
look like a tracked artifact, not a message — it must render as a REGULAR message: the
colleague is responding in the chat directly as a participant.

**Shipped shape (supersedes the 2026-07-27 compact-box call):**

- An inbound report/update/direct row renders its FULL marker-stripped body inline as
  markdown — exactly like any participant's message. Identity = the persona author line +
  the quiet Report/Update/Message badge; the "your message" bubble still sheds.
- The accent left-bar now marks assistant-role persona rows only — inbound rows wear no
  special chrome.
- Retired end-to-end (dead code the moment the door went): the teaser + "View
  report/update/message" chip, the `openReport` emit chain (MessageRow → ThreadStream →
  both views), `ui.viewingReport`, and `ReportViewDialog` (file deleted, AppShell mount
  removed).
- Unchanged: the model-facing attribution marker (the badge + strip still read it), the
  absorb/steer machinery, pointers.

**Verified:** typecheck 24/24 forced; 213 tests green (MessageRow pins recast to
full-body + badge — `test: correct expectation`, spec change by Chad).

**Refinement (same day, Chad's browser pass):** a LONG delivered message collapses to its
lead paragraph with an in-place expander — chevron pill, "Show full report/update/message"
→ "Show less", expands in the thread (never a popup). The affordance appears only when the
hidden remainder is substantial (>200 chars past the first paragraph); short messages
render whole. Pins: collapse/expand round-trip + short-message-no-chip.

**Refinement 2 (Chad's mock — the tool-card treatment for REPORTS):** a report renders
like a tool card: report ICON + the lead line as the TITLE, the chevron flowing inline at
the line's end (the whole line toggles), the body unfolding in place below. The header
REPORT badge retires — the icon carries the kind. Reports always fold at the first
paragraph (a one-liner card gets no chevron). Updates/direct messages stay regular
messages with their badges + the long-fold pill. Pins recast: card round-trip, no-badge +
icon, one-liner-no-chevron, direct-pill kept.

**Refinement 3 (spacing + "same to message and update"):** the unfolded body now breathes —
inset under the TITLE text with a quiet hairline down the icon column (the tool-group
idiom), 8px top gap. And ALL THREE kinds card now, each with its own icon: report =
document, update = clock, message = speech bubble (`data-kind` on the card). ALL header
kind badges retired; the pill expander deleted. One fold rule for every kind: fold at the
first paragraph only when the remainder is substantial (>120 chars) — a short body renders
whole on the title line, no chevron.

---

## Post-smoke tweak 5 — foldable turns (Chad, 2026-08-09; SHIPPED)

**Instruction (his mock):** make all chats expandable — a collapsed view is
icon · first message · time · expand option; expanding shows the regular view. The last
message is expanded by default; the user can expand/collapse any message.

**Shipped shape:**

- **The unit is the TURN** (a header row + its continuations — the existing
  `showsHeaderFor` grouping), keyed by its first row's id. Folded = one strip: author
  glyph + name, a one-line first-line preview (marker-stripped, md-chars cleaned), and the
  time + chevron cluster at the RIGHT edge (the mock's red box). The header and the
  chevron both toggle.
- **Default:** only the LATEST turn is open; a manual toggle overrides its turn from then
  on — so an arriving turn folds the previous one unless the user pinned it open.
  State lives per ThreadStream instance (all four chat surfaces get it for free).
- **Integrations:** pointers render even under a folded turn (a tracker never hides);
  pointer-anchor landing unfolds the anchor's turn before scrolling + flashing.
- **MessageRow** grew `collapsible`/`collapsed` props + a `toggleCollapse` emit — hosts
  not passing them (LiveTurn, the active-turn user row) render exactly as before.

**Verified:** full local-web suite 544/544 + ui suites green; typecheck 24/24 forced.
Pins: default-fold + latest-open, chevron round-trip, anchor-unfolds-turn, folded-turn
continuations return on open (grouping pin recast), plain rows unchanged.

---

## Post-smoke tweak 6 — author-line icons + run receipts (Chad, 2026-08-09; SHIPPED)

**Instruction (his mock):** persona icon + a WORKSPACE icon in the author line (icon
option per workspace); after it another icon whose hover shows the conversation's
metadata — model used, tool calls, tokens, time to complete; the workspace icon's hover
shows the workspace name like a profile card.

**Shipped shape:**

- **Server** — `attachDeliveredRunStats` (session tier, the task-labels sibling): a
  delivered colleague row resolves its delivery hop → the chain's latest WORK hop → that
  run's stats: model (job override, else the session's), tool-call count + token sums off
  the trace rows, duration = claim → report/completion. Rides `ChatMessageResponse.runStats`
  on both detail reads (root + workspace); SDK regenerated.
- **UI** — the label's workspace segment (LAST " · ", the persona-first rule) becomes an
  accent-tinted icon chip; hover = profile card (chip + name + "Workspace"). `runStats`
  grows the ⓘ door; hover = Model / Tool calls / Tokens (in · out) / Took. Tooltip gained
  a rich `#content` slot; `splitSourceLabel` is the one-home split.
- **Workspace icon option** — `workspaceImage` in the local customize store (per-scope,
  like the persona image) + a WorkspaceIconPicker in the workspace Customize section;
  the chips read it via the hosts' name→id map (ThreadStream stays data-blind).

**Verified:** typecheck 72/72 forced; 229 tests green (enrichment resolution incl.
session-model fallback + orphan pass-through, chip/label split, info door, store
round-trip, splitSourceLabel last-segment rule); SDK/MCP/port parity OK; live via
playwright — real cards: "Model claude-fable-5 · Tool calls 6 · Tokens 229.4k in · 35 out
· Took 32s" and "CL · Claw Launcher · Workspace".

---

## Gate-3 review of the tweak arc (`a9df994..f7862b3`, 2026-08-09) — VERDICT: ship-worthy; fixes applied

Full code-reviewer pass over all 17 tweak commits (invariants clean, DOMPurify covers the
new render path, recast pins honest). **Fixed same-day:**

- **MUST-FIX — the direct exception matched the whole CHAIN:** on a continued colleague
  thread, task 2's normally-narrated report was falsely absorbed ("already sent DIRECTLY")
  because task 1's direct hop sat on the same thread. `finalReportWentDirect` now windows
  to THIS work hop's own deliveries (after it, before the chain's next work hop) + a
  regression pin (task 2 completes SURFACED).
- **Direct delivery co-commits:** persist + complete now share one transaction — a crash
  between them could requeue and land the row twice.
- **Chain scans read unbounded:** `listDelegationJobsByThread` grew an `unbounded` option
  for the correctness scans (direct window, mention floor, run-stats pairing) — the 50-row
  cap stays for list surfaces.
- **One home for the label parse:** `workspaceNameFromLabel` now delegates to
  `splitSourceLabel` (two crowns → one).
- **Mention-chain fallback runs the DIRECT steer** (it narrated under the report steer on
  the rare no-root-row fallback) + the misplaced contract doc comment restored.
- **Fold keys stabilized:** turn-fold keys derive from the FULL history, not the visible
  window — revealing older pages no longer re-keys a boundary turn and orphans a pin.

**Recorded, deferred:** file-size splits (MessageRow.vue 1009 / ThreadStream.vue 602 /
run-report-delivery-tick.ts 405 — extract InboundMessageCard + hover cards + the fold
strip next touch); `recordDirectReplyMessage` hardcodes sourceKind 'agent' for workspace
managers (taxonomy only); short direct titles flatten onto one line (cosmetic);
millisecond-tie hop pairing edge (vanishing).

---

*(Case 4+ land here as received.)*
