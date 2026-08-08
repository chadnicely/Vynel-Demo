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

*(Case 4+ land here as received.)*
