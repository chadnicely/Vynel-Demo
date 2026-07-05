# Vynel — current state (RESUME HERE)

**Updated 2026-07-06.** After a compaction read this first, then `CLAUDE.md` →
`docs/architecture.md` + the memories. State lives on disk, not chat.

## 🏁 SURFACE-UP APPROVAL BUILT (2026-07-06) — all 4 moves committed, gate 1874, reviewer-clean

**Shape shipped (Chad's revision): approvals surface on WEB ALWAYS + the ORIGIN CHANNEL (Telegram) when
the flow came from one; decidable from either surface (second decider gets "already handled").** The
routed auto-deny is GONE — replaced by record-and-park for ALL origins. Commits: `2276a4e` (docs) ·
`23f7fc5` (Move 1 mode threading: `delegation_jobs.permissionMode` baseline-folded, `/root/turn` accepts
`mode`, brain turn + routed turns run under it, web sends composer mode on global turns) · `b5c4e9f`
(Move 2 record-and-park: `buildRoutedApprovalHandler` records workspace-scoped + pushes the channel card
+ fail-closed on record-throw; `drainLeafTurn` breaker now counts approval-RESOLVED denials [provider
contract pinned in normalized-session-event.ts]; `routeRequest` wait budget SUSPENDS while parked via
`ApprovalWaitGate`; `recoverStalePendingApprovals` now async + unblocks the parked provider FIRST
[NotFound→post-restart row; other errors keep the row pending] and is WIRED as the 60s
`approvals-recovery-service` — it was called NOWHERE before) · `a17a282` (Move 3: brain-turn cards
pushed to the origin channel via `routeAsChatTurn` → `runRootTurn.onApprovalRequested` →
`GlobalRootDrainSink`; typed-reply correlation stamped) · `949bb05` (polish: cards name the acting
workspace; Watch-panel echo collapse [display-only — the trace read stays faithful]; routed turns get a
read-tool steer via systemPromptAppend). Code-reviewer: no must-fix; both should-fixes applied.

**⏭ CHAD TO LIVE-SMOKE (can't be unit-tested):** ① web: route a WRITE task ("in vynel, create notes.md
with X") in Ask mode → notifier card appears (≤5s poll) → approve → task completes + report bubbles;
deny → task reports it stopped. ② Telegram: send a write task → card arrives in Telegram with buttons →
tap Approve → report arrives in Telegram; also try typed "approve". ③ Telegram brain-card:
"set up a workspace for X at path" from Telegram → register_workspace card in Telegram + web. ④ Let one
card sit ~10min → reaper denies → task resumes with a "couldn't finish" report. ⚠ Baseline was folded
again (`permission_mode`) → **delete `.data/vynel.dev.db*` before smoking** (the stale-dev-DB papercut).

**Deferred-improves (reviewer-noted, non-blocking):** stale pending card after a rare fail-closed deny
(bounded by the reaper; notifier could render better) · timed-out JOB + late park = real card for a
terminal job (pre-existing "result not surfaced after timeout" limitation, now more visible) · fakes
support one approval per instance (multi-approval covered by unit tests only) · delegation-origin
channel cards can't correlate a TYPED "approve" (no inbound row; buttons carry the id — fine on
Telegram) · web notifier card still generic (actionKind contract gap, tracked since M7).

**Goal:** routed tasks (brain → workspace) can DO work with Chad's approval, instead of read-safe
auto-deny. Chad's complaint: "route to workspace: it said routed but the task couldn't perform actions,
and the Ask/Auto/Bypass mode isn't bound."

**Why it's CHEAP in KLONE (the old repo feared a big re-architecture; the hard parts already exist here):**
the provider PARKS a background turn on approval (`build-claude-can-use-tool-callback.ts` awaits a Promise
via `PendingApprovalRegistry`) and resumes on `respondToApprovalRequest`; `resolveApproval` already calls
that; the approval NOTIFIER already polls user-scoped `listPendingApprovalsForUser` (5s) + decides. So a
routed task's RECORDED approval surfaces in the existing notifier automatically.

**The build (green + commit each; drain change → code-reviewer, AI seam):**
1. **Mode threading (no behavior change yet).** Add nullable `permissionMode` column to `delegation_jobs`
   (baseline-fold, pre-release). Thread: `StartGlobalRootTurnRequest.mode` → `run-global-root-turn(-core)`
   holds it → stamp on the in-process delegate app-request (a header mirroring `DELEGATION_ORIGIN_HEADER`
   in `sessions/delegation-origin-header.ts`) → `POST /routing/delegate` reads it → `enqueueWorkspaceDelegation`
   stores it → delegation-service → `runRootDelegationTurn` → `provider.startChatSession({ permissionMode })`.
   Web: `use-chat-turn` sends `mode` for GLOBAL turns too (currently workspace-only). Bind mode to the
   brain's own turn: `run-global-root-turn-core.ts:112` uses `input.mode` not hardcoded `'bypass-with-behavior-gate'`.
2. **Surface-up in the routed turn (ALL origins).** Replace the auto-deny
   (`buildRoutedLeafApprovalDenier`) with **record-and-park**: an api-side handler calls
   `recordApprovalRequest(db, {providerApprovalId: event.approvalRequestId, userId, workspaceId (target),
   sessionId (SDK id, FK-less), parentMessageId, toolUseId: approvalRequestId (chat's placeholder
   convention), toolName, toolInput})` and RETURNS WITHOUT RESPONDING (provider stays parked; a rule match
   inside may auto-approve — that's correct). Web notifier picks it up automatically. If the job carries
   origin channel columns → ALSO enqueue the approval card to that channel (refactor
   `enqueueApprovalRequest` to accept a recipient-target without an inbound row; buttons carry the explicit
   id). `drainLeafTurn` gains `approval-resolved` passthrough; the 2-denial breaker now counts USER
   denials. Suspend `routeRequest`'s WAIT budget while parked (pausable timeout). Wire the
   `recoverStalePendingApprovals` reaper interval in local-api (was never wired — the unanswered bound).
3. **Brain-turn channel push.** Telegram → global-root turn already RECORDS approvals (chat consumer →
   global queue → web notifier); thread `approval-requested` from the drain sink out to `routeAsChatTurn`
   (via `RunGlobalRootTurnInput.onApprovalRequested` + `ProcessInboundDeps`) → the leaf's
   `enqueueApprovalRequest` with full inbound context (typed "approve" correlates). Reply side already
   works (`derive-intent-kind` → `route-as-approval-reply`).
4. **Polish.** Notifier approval-card context for a routed action (workspace + tool + task text). Dedupe the
   duplicate delegation-trace entry (workspace reply + pushed report have the same body). Steer the routed
   agent to read-safe tools (Glob/LS/Read) for read tasks (Noah reached for Bash → denied on "list files").

**Decisions locked (plan doc §"real decisions"):** A=surface-up · B=**ALL ORIGINS — web always + origin
channel** (Chad 2026-07-06; web-only dead) · C=accept parked-holds-serial-slot for v1 + suspend the
wait-timeout while parked; the reaper bounds an unanswered card (~10 min → denied → turn resumes).
**Serial delegation caveat:** a parked routed task holds the single serial slot until decided — fine for
single-user v1.



## 🏁 DELEGATION works end-to-end (Chad-verified live) + tracking layer built (2026-07-06)

**"Route task to workspace didn't work" was TWO things, both now fixed:**
1. **STALE DEV DB (the real blocker).** Chad's `.data/vynel.dev.db` was created 2026-07-04, before several
   schema changes were **baseline-folded** (edited into `0000_baseline.sql` rather than added as
   migrations): `schedule_kind` + nullable cronExpression, nullable `workspaceId`, `primary_sessions`
   rename, etc. Migrations don't re-add baseline-folded columns → the DB was permanently missing them →
   `GET /dashboard/overview` crashed on `no such column: "schedule_kind"`, and the delegation path
   errored server-side. **Fix: deleted `.data/vynel.dev.db{,-wal,-shm}` + restarted → fresh DB from the
   current baseline.** ⚠ **RECURRING PAPERCUT** — baseline-folding wipes Chad's dev DB on every schema
   change now that he RUNS the app. Consider switching to incremental migrations once closer to real use.
   See memory [[stale-dev-db-baseline-folding]].
2. **NO frontend observability (the "didn't see it hit").** The delegation MECHANISM is a byte-for-byte
   faithful match to the old repo (read-safe async queue → `recordPushedReportMessage` push) — NOT a
   regression. But KLONE's fresh UI never ported the old repo's live-tracking. Built it fresh:
   - **Slice 1 (`205c87a`):** `use-in-flight-delegations` polls `root.listDelegations()` (4s) while global
     chat is open → "⚡ Working in {workspace}…" banner + keeps the global thread live (`useSessionDetail`
     gained an optional `refetchInterval`) so the pushed report surfaces within seconds.
   - **Slice 2 (`c7aff25`):** the "Watch X" chip was MISROUTED (passed the delegation `partialSessionId`
     to `root.getSession` → 404). Fixed: `use-delegation-trace` polls `root.getTrace(partialSessionId)`
     (2.5s while pending/claimed) and `SessionViewerPanel` renders the condensed trace (task → reply →
     report) filling in live. Simplified the viewer store to a single key (traces are flat, no drill-down).

**✅ Chad-verified live (screenshot):** created workspace "vynel" (Noah) via `register_workspace` →
"send task to vynel: list all files" → `route_to_workspace` → the delegation RAN → Noah's report bubbled
back into the global thread ("ASSISTANT · NOAH · VYNEL") → the "Watch Noah · vynel" chip appeared.

**READ-SAFE is by design (matches old repo, deferred fork 3).** Noah's report said "I couldn't finish —
a routed task can't perform writes/edits/irreversible actions yet" — because it reached for Bash (carded
→ auto-denied; 2 denials → circuit breaker). Routed tasks are read/analysis-only; the report correctly
tells the user to open the workspace chat to do actions there. **Write-capable delegation = surface-up
approval (brain-tree fork 3), deferred in BOTH repos — a real product decision for Chad.** Minor rough
edge: for read tasks the routed agent reaches for Bash instead of read-safe tools (Glob/LS/Read).

## 🏁 M7 done — desktop UI WIRED to the real API + unit-green. `src/demo/` GONE. ⚠ NOT yet live-smoked.

**Honest status: the code is wired to the real API and unit/typecheck-green, but the integration seam
has NEVER run against a live `local-api` this session** (app-shell test mocks the client; parser/fold are
isolated unit tests; reviewers read, didn't execute). So it's *wired + green*, NOT *verified working* —
Chad's live smoke is the real gate. **All 5 slices done + pushed** (A+B `78bbe2c` · C `ddc275c` · E
`8ff3bbd` · D `6e20489` · journal `5609604`). Full gate **1839/4-skip** (was 1835; +streamer/parser
tests, −demo tests). The demo data layer no longer exists.

**⚙ LIVE-BOOT SESSION (Chad tried to smoke it — three real findings, all fixed/actionable):**
- **`pnpm dev` couldn't boot the API — FIXED (`5609604`-ish commit).** `apps/local-api`'s dev script was
  `tsx watch …`; **`tsx watch` spawns a child whose stdio DEADLOCKS under turbo's output multiplexer on
  Windows** — it never binds 8998 (Vite/web is fine; only the api hung), so the browser got ECONNREFUSED
  everywhere. It boots in 250ms standalone (`pnpm --filter … dev`, inherited stdio) but hangs under turbo
  AND pnpm `--parallel` (both multiplex). Fix: dev script → `node --watch --env-file-if-exists=../../.env
  --import tsx src/server.ts` (Node's watcher runs IN-PROCESS, no child). Verified end-to-end: `pnpm dev`
  → API 200, Web 200, proxy `8999/api`→`8998` 200. **(Gotcha for the whole repo: prefer `node --watch
  --import tsx` over `tsx watch` for any turbo-run dev server on Windows.)**
- **Stale demo `activeWorkspaceId` in localStorage — FIXED (`4d3222f`).** WorkspaceView only auto-picked a
  workspace when the stored id was null; a leftover `demo-ws-bookkeeping` slipped through → 404s. Now
  reconciles any persisted-but-missing id to the first real workspace (or null) once the list loads.
- **Create-workspace — SOLVED via MCP (Chad's pick over a UI form).** No UI switcher-"+" create yet, BUT
  the assistant can now create workspaces conversationally: `register_workspace` is a **brain-surface**
  (`x-mcp.rootSurface: true` — a new generator flag routing a user-scoped tool to `generatedRoutingMcpTools`
  without a `/routing/` path), **mutating → CARDS** (in `vynelRoutingDescriptor.mutatingToolNames`; card
  fires on both global-root surfaces — reviewer-traced). Regen: 34 MCP tools. Gate green, reviewer CLEAN.
  So on a fresh DB, tell the global chat "set up a workspace for X at C:\path" → it cards → creates.
  (A UI "+"→register form is still a nice-to-have; not built.) Files: route x-mcp on `POST /workspaces`,
  `McpExtension.rootSurface`, generator `isRouting || rootSurface`, descriptor mutatingToolNames.

**⚠ TWO LIVE-BOOT PREREQS (checked the files; #2 is a real blocker on a fresh DB):**
1. **Vite `/api` proxy — FINE.** `apps/local-web/vite.config.ts` forwards `/api/*` (wildcard, rewrite
   `/api`→``) to `LOCAL_API_URL` — so `/root`, `/dashboard`, and the SSE turn paths all forward. (The
   `vynel-client.ts` comment listing "/workspaces, /users" is illustrative prose, not an allowlist.)
2. **First-launch gate — now ENV-DRIVEN (was hardcoded on).** The gate (`middleware/first-launch-gate.ts`)
   412s EVERY non-onboarding route until the single local user completes onboarding, and expects the WEB
   CLIENT to catch the 412 and show a wizard — which **local-web does NOT have** (never built). So on a
   fresh `.data/vynel.dev.db` the UI would be dead (412 everywhere). **FIX (done):** `server.ts` now reads
   `enableFirstLaunchGate` from the new `VYNEL_FIRST_LAUNCH_GATE_ENABLED` env (in `local-api/src/env.ts`,
   default `'1'` = ON, production-safe). **To smoke M7: put `VYNEL_FIRST_LAUNCH_GATE_ENABLED=0` in the
   repo-root `.env`** (disables the gate for dev). Building the onboarding wizard is the real long-term
   fix (separate surface, not M7). The gate itself is NOT an M7 regression — pre-existing.
3. **SSE-buffering-through-the-proxy is the #1 live risk** (only a boot reveals it): dev proxies routinely
   BUFFER `text/event-stream`, which makes a turn hang then dump the whole response at once — looks like
   "streaming is broken" though every frame-parser test passes. Chad must watch for INCREMENTAL token
   rendering, not just "the turn completes."

**Minor (STATE note for whoever touches the composer):** `composerModelId` is NOT persisted to
localStorage (only `theme` + `activeWorkspaceId` are) — good, because a stale demo `claude-sonnet-5`
would 400 every turn against the real `CHAT_MODEL_IDS` allowlist. Don't add persistence there without a
validity guard against the current allowlist.
- **A** workspaces + dashboard · **B** chat vertical (reads + live SSE turn + approvals + interrupt) —
  reviewer SHIP-clean. **C** feature sections (5 `enabled`-gated per-domain reads). **E** model picker =
  real `CHAT_MODELS`, model on every turn. **D** files area — LAZY per-directory tree
  (`FileTreeNode` fetches children on expand), ASYNC editor read + real-disk save mutation, truncated/
  binary → READ-ONLY (a partial buffer can't overwrite the file). Reviewer caught + I fixed a HIGH
  data-loss bug (dirty draft A leaked onto file B's disk path via a vue-query undefined-tick →
  `:key="filePath"` fresh-instance-per-file fix) + 2 should-fixes (save-error surface; FileTreeNode
  `workspaceId` getter).
- **Only "demo" left = `VoiceOverlayDemo`** (Jarvis voice ANIMATION — parked pending the voice engine;
  it's UI, not data). `createLocalVynelClient` is just the app's real-client factory name.

**⏭ CHAD TO SMOKE-TEST LIVE (can't be unit-tested):** boot `local-api` + `local-web`, register a
workspace, send a chat message (stream renders? approval card decides?), open+edit+save a file
(persists to disk? alt-tab mid-edit keeps the draft? truncated/binary read-only?), expand a folder
(lazy-loads?). Real data = EMPTY until seeded — an empty first boot is correct, not a bug.

**Deferred-improves logged (non-blocking, Chad's call when):** ① `use-chat-turn.interrupt()` best-effort
catch is silent (app has NO logger layer by design — documented); ② `settleFailedTurn` on a PURE
client-side network drop flashes errored then clears (server errors persist+refetch fine — rare edge);
③ `saveContent` has no ETag/version guard (lost-update if disk changed under a dirty draft — inherent to
the files API contract, not a slice bug); ④ approval `actionKind` absent (contract gap — generic card);
⑤ live delegation drill-down dormant (no per-session-subscribe endpoint — session-viewer reads by-id).

**Next surfaces (parked, not M7):** M6 Tauri shell (own session — long first cargo build) · voice-engine
module (`@vynel/voice-engine`) + sidecar · attachedImages into the turn (composer accepts, not yet sent).

### (superseded below) M7 progress detail

**M7 is sliced (advisor-blessed): A workspaces+dashboard · B chat keystone · C feature-sections ·
D files · E model-picker · F residual cleanup. Green + commit each.**

**🏁 A+B COMMITTED+PUSHED (`78bbe2c`, reviewer SHIP-clean) · C DONE (commit pending).** Full gate
1842/4-skip. The demo namespaces are gone; `workspaces.list`, `dashboard.getOverview`, and the whole
**chat vertical** (reads + live SSE turn + approvals + interrupt) hit the real API. **Slice C:**
workspace drawer feature sections (skills/channels/schedules/knowledge/marketplace) read real
per-domain lists — 5 thin `enabled`-gated composables in `composables/{skills,channels,schedules,
knowledge,marketplace}/`; `WorkspaceSectionPanel` rewired; `fixtures/feature-sections.ts` deleted.
**C field notes:** knowledge `listSources`→`{sources:[...]}` (unwrapped via `select`) exposes
`absolutePath`+`updatedAt` only (NO displayName/documentCount/lastIndexedAt → panel shows folder
basename + path + "updated"); skills installed-row nests catalog under nullable `definition`. C was
self-reviewed (trivial display reads), not a full reviewer pass.
- **Streamer (the one net-new piece):** generated `startTurn` BUFFERS (openapi-fetch resolves the
  whole body) → can't stream. So `composables/chat/chat-turn-stream.ts` calls the typed path-keyed
  `client.POST(path, { parseAs:'stream', signal })` → `ReadableStream` → pure `sse-frames.ts` parser
  (unit-tested: byte-split, terminal `{}`→`turn-stream-ended`) → `AsyncGenerator<ChatTurnEvent>`. The
  `applyChatTurnEvent` fold was UNCHANGED (already typed to the full real 15-member union).
- **Scope split:** workspace=`chat.*(workspaceId)`, global=`root.*()` (user-scoped, NO session list,
  NO workspaceId, NO interrupt endpoint). `use-session-list` global→`[]` (product-correct: one brain).
  `use-session-detail` global→`root.getSession`, workspace→`chat.getSession`. Global thread reads
  `root.getSession(currentSdkSessionId)` NOT `getTranscript` (transcript's lean message type ≠
  `ChatMessageResponse`; getSession is rich + swap-history is a later improve).
- **Approvals:** inline cards route through the EXISTING `useDecideApproval` mutation
  (`approvals.decide(providerApprovalId)` — user-scoped, resolves any of the user's approvals; the
  SSE `approvalRequestId` IS the `providerApprovalId`); stream reflects via `approval-resolved`.
  `use-chat-turn` sheds `decideApproval` entirely. `denied` needs a `reason`.
- **Contracts root-fix (contained — only `@vynel/ui`+web import these):** `ChatSessionResponse.workspaceId`
  → nullable, `ChatToolCallResponse.toolInput/toolOutput` → optional, to match the wire (the API's own
  `ChatSessionSchema` is already nullable; `z.unknown()`→optional key). Zero backend ripple.
- **Deferrals (real API gaps, NOT laziness):** live delegation drill-down (no per-session subscribe
  endpoint — session-viewer dormant on real data, reads by-id via `root.getSession`); approval
  `actionKind` (contract lacks it — generic card); `model` not sent on turns (picker still demo → slice E).
- **Reviewer's 2 deferred-improves (non-blocking):** `interrupt()` best-effort catch swallows (app has
  NO logger by design — documented catch, left); `settleFailedTurn` on a PURE client-side network drop
  flashes errored then clears (server errors persist+refetch fine; genuine rare edge — deferred).
- **Commit msg (pending):** `feat(web): swap workspaces, dashboard, and chat to the real API`.
- **⏭ NEXT after commit:** slice C (feature sections → `client.{skills,channels,schedules,knowledge,
  marketplace}.*` per-section composables; `WorkspaceSectionPanel` fixtures are already contracts-typed).
  Then D (files `client.files.*`), E (model picker → real provider/models or defer), F (delete residual
  `src/demo/` + gate + reviewer). Remaining demo files: `demo-file-store`, `fixtures/{file-trees,
  feature-sections,models}`.

### (original) THE API IS COMPLETE — swap the UI demo seam to real data (M7)

**🏁 API-COMPLETION MISSION DONE (2026-07-05, agent-driven waves; journal
`.claude/journal/2026-07-05-api-completion.md`).** Every remaining source route group is ported,
mounted, typed, gated, reviewed (CLEAN after 1 must-fix closed), and committed — 7 commits
`512de7a..4a5c31a` (local, unpushed). **Surface: 109 paths · 131 SDK methods · 22 namespaces ·
33 MCP tools** (29 main + 4 routing in the global-root-only array). Full unfiltered `pnpm test`
green: typecheck 64/64 · parity · **1835 passed / 4 skip**. Boot smoke: 109 live paths; schedules +
channels + **delegation** services all start.

**What landed on top of the previous state:** chat (12 + `chat-turn` SSE) · root (6 +
`global-root-turn` SSE + trace) · routing (4 + claim-and-run tick + `services/delegation-service`)
· workspaces/memory/agents/capabilities/users/files · providers (+`packages/providers/src/status/`)
· `@vynel/onboarding` (decoupled leaf, `OnboardingDeps` injection, first-launch gate behind
`enableFirstLaunchGate` — server-only) · approvals workspace+rules (user queue → `user-scoped.ts`)
· `GET /dashboard/overview` (net-new, models the UI demo aggregate). **Plus the class fix: response
schemas on every JSON 200/201** (description-only responses made the whole SDK return
`Promise<never>` — only knowledge was typed) + the generator path-param typing fix.

**⏭ For Chad (the M7 swap, per `docs/module-notes/desktop-ui.md`):** delete `src/demo/`, regen, adapt
per-namespace. Already discovered at the seam (fixed in-tree): workspaces list = **bare array** on the
real wire; dashboard `recentSessions[].workspaceId` is **nullable** (null = global-root). `GET
/sessions` returns `ChatSessionListItem` (adds `lastMessagePreview`). Still owed to the UI:
**`ChatTurnEvent` `approval-requested` lacks `actionKind`** (contracts change — do deliberately).

**Deferred (non-blocking):** CLI mirrors for the 14 new namespaces (mission was "api only") ·
route files >300-line sweep (chat/index.ts 397 worst; `files/` shows the sub-router split) ·
onboarding outbox events (faithful-absent) · desktop observation on the web root turn (no
desktop-control in local-api) · the pre-existing integration-test seam. **Autopilot learnings**
(network-drop agent casualties, workflow-resume cache miss vs live rewriters) are in the journal.

## (previous) 2026-07-04 autopilot — the remaining-leaves mission
**🏁 The "remaining leaves" autopilot finished GREEN.** All 5 leaves landed as per-feature verticals
(voice · skills · channels · schedules · marketplace), each pull → decouple → scope-improve → HTTP API →
full-gate → code-reviewer → commit. Suite **1462 passed / 4 skip**; **10 commits `0194ec3..3a92ed5`**
(local, unpushed — matches the recent local-only cadence). Journals: `.claude/journal/2026-07-04-{voice,
skills,channels,schedules,marketplace}-pull.md`. Chad's two notes both delivered: **global-or-workspace
scope** (channels + schedules `workspaceId` nullable) and **two schedule kinds** (recurring cron vs one-time
`fireAt`, create exposes both — the source already implements it; the explicit `scheduleKind` column is a
deferred legibility improve, Chad's call).

**The APIs Chad can build UI on now** (typed SDK, `apps/local-api`): `client.skills.*` (8) · `client.channels.*`
(9) · `client.schedules.*` (8) · `client.marketplace.*` (2). All workspace-scoped under `/workspaces/:id/…`.
**✅ BOOT-SMOKE VERIFIED** (not just `pnpm test`): `pnpm --filter @vynel/local-api dev` boots clean (migrations
run, DB created), `GET /openapi.json` → 200, all 34 new routes live in the spec, marketplace→skills composes at
boot. **Boot prereq (papercut):** the default `DB_PATH=.data/vynel.dev.db` dir must EXIST first — better-sqlite3
won't mkdir it. I created `.data/` (gitignored, so it's there on this machine); a fresh clone needs `mkdir .data`
first. Cheap real fix (deferred, out of mission scope): `mkdirSync(dirname(path),{recursive:true})` in
`packages/db/src/client.ts createSqliteDatabase`.

**Deferred to the session Slice-3 app-wiring** (the SAME app-wiring already owed for delegation SSE sinks;
they compose env-coupled/turn-firing machinery a leaf can't own — NOT gaps, deliberate deferrals):
- **Poll-tick worker bodies**: `run-channel-{polling,delivery}-tick`, `run-schedule-claim-and-fire-tick`
  (worker cron; provide the real injected `resolveApproval`/`startChatTurn`).
- **`POST /schedules/:id/fire-now`** (route 9/9) — needs `composeSessionMcpServers` + `vynelWorkspaceDescriptor`;
  lands as 1 route + a `FireScheduleDeps` binding.
- **Injection-cast reconciliation** at wiring: channels `resolveApproval` (workspaceId string→user-scope adapter),
  the contracts-`ChatTurnEvent` (wire) → runtime-event cast at the polling tick.
- **⚠ Global scope is SCHEMA-READY but NOT YET API-REACHABLE** (Chad — this is the consequence of your
  global-or-workspace note). The schema + core ops accept null `workspaceId`, BUT the channels/schedules HTTP
  routes are ALL workspace-scoped: `create` takes `workspaceId` from the URL path, and `list` filters
  `WHERE workspaceId = ?`. So via the API you'll build UI on, a **global** channel/schedule is currently
  **uncreatable and invisible** — a "remind me in 20 min" global reminder can't be made through the API yet.
  Cheap close (when you decide the UX): a user-scoped `/channels` + `/schedules` create/list, using knowledge's
  in-repo precedent — a `scope: 'global'|'workspace'` body param → `scope === 'global' ? null : workspaceId`
  (see `apps/local-api/src/routes/knowledge` `POST /sources`). Small change; the data model is already there.
- The cross-feature `schedule-channel-delivery.integration.test` (relocate to the app composition layer).
- **CLI commands** for the 4 features (deferred mission-wide — a nicety, not UI/parity-critical; mirror
  `apps/cli/src/knowledge-commands.ts`).

**Deferred improves** (mission-wide, non-blocking): stale kernel-location doc-comments in the new leaves'
`repositories/*` + `schema/index.ts` (name the old `@vynel/db/...` home).

## 🔨 FINISH-EVERYTHING pass (2026-07-05) — Chad: "complete them all, no deferring"
Clearing every deferred item. Progress (TaskList #7-13):
- ✅ **Explicit `scheduleKind` column** — replaced the `@once` sentinel with a `scheduleKind:'recurring'|'one-time'`
  column + nullable `cronExpression`; `isOneTimeSchedule` reads the column; response surfaces it. Baseline-folded
  (zero-data → the migration-0029 risk the sentinel dodged no longer applies). drizzle "No schema changes"; gate
  **1463**; reviewer CLEAN (no-must-fix). `ONE_TIME_CRON_SENTINEL` removed.
- ✅ **Global-scope user-scoped routes** — added `/channels` (`channelsUser.*`, 10) + `/schedules`
  (`schedulesUser.*`, 7) at the root; global (null-workspace) + cross-workspace resources now creatable/
  listable/manageable. New userId-scoped core ops (getChannelForUserOrThrow + thin user-ops; listSchedulesForUser).
  TENANT-isolation test present. Gate **1494**; kept workspace-scoped routes. `.claude/journal/2026-07-05-global-scope-routes.md`.
- ✅ **③ agent-turn MCP binding keystone** — ported `buildInProcessMcpServer` + `vynelWorkspaceDescriptor`
  (apps/mcp) + `composeSessionMcpServers` (apps/local-api/src/sessions). Wraps the 16 generated tool factories
  in `createSdkMcpServer` (SDK builder, single-site, MCP-layer-allowed); tool-gating aligned to KLONE's real
  registry (7 knowledge tools gated; mutatingToolNames [] = auto-approved). NOT yet wired to a live turn.
  Gate **1517**; reviewer CLEAN. `.claude/journal/2026-07-05-mcp-binding-keystone.md`.
- ✅ **Schedule firing WIRED** (reordered ahead of channels — the schedule fire uses the built workspace-turn
  path). Ported `run-schedule-claim-and-fire-tick`; `buildScheduleFireDeps` binds the ③ keystone +
  `startChatTurn`/`composeSessionCapabilities`; `startSchedulesService` (60s poll, boot); `POST /:id/fire-now`
  (workspace + user, no x-mcp, tenant-guarded). Boot smoke: "schedules service started" → "api listening".
  Gate **1548**; reviewer CLEAN. `.claude/journal/2026-07-05-schedule-firing-wired.md`.
- ✅ **Channel poll + delivery ticks (11a)** — ported `run-channel-polling-tick` + `run-channel-delivery-tick`
  to `@vynel/channels` (were deferred); `startChannelsService` boot service runs poll(5s)+deliver(2s), errors
  scrubbed via `extractErrorMessage` (+ token-scrub regression tests). Leaf pure. Gate **1561**; reviewer CLEAN.
- ✅ **Channel inbound-PROCESSING (11b) WIRED** — ported the global-root turn EDGE into apps/local-api/src/sessions/
  (`run-global-root-turn` + drain sink · `resolve-global-root-conversation` [root→primary rename] · `global-root-
  workspace` · `delegation-origin-header`) + the channels-service processing loop (turnDeps: runRootTurn→
  runGlobalRootTurn, resolveApproval from @vynel/approvals). A channel message → global-root turn (routing-toolless
  direct answer today) → reply. My backend slice GREEN (59/59 backend typecheck · full vitest **1571** · parity);
  reviewer CLEAN. Desktop de-scoped (KLONE boots no desktop reader). Deferred-improve: failed turn is silent to the
  channel SENDER (marked failed+logged, but no error status enqueued back — small UX add in route-as-chat-turn).
- ⚠ **FULL `pnpm test` is RED at typecheck — ONLY on Chad's `@vynel/local-web`/`@vynel/ui` UI WIP** (uncommitted;
  broken component types, e.g. MenuListView.vue missing). NOT my code (backend 59/59 green). Chad must fix his UI
  types for the combined gate to go green. Backend commits verified via `--filter=!local-web --filter=!ui`.
- ✅ **CLI commands** — `vynel {skills,channels,schedules,marketplace} <...>` over the namespaced SDK
  (mirror knowledge-commands); 26 new tests. Reviewer CLEAN (arg-order verified, token-safe — connect not exposed).
- ✅ **Cleanups** — `.data/` boot fix (`createSqliteDatabase` mkdirs the DB dir; test added) + 14 stale
  kernel-location doc-comments swept in channels/schedules/skills (comment-only). Integration-test relocation
  STOPPED (needs an unbuilt seam — exported outbound-queue reader / app-mockable adapter / outbox relay; delivery
  mechanics are unit-covered in-leaf; a deliberate call for Chad, not stubbed).
- 🏁 **FINISH-EVERYTHING PASS COMPLETE** (7 backend commits: scheduleKind · global-routes · ③ keystone ·
  schedule-firing · channel-poll/deliver · channel-processing · CLI+cleanups). Everything Chad listed is done
  except the two honest stops above (integration-test seam · failed-channel-turn sender UX) + the one BLOCKER:
  Chad's UI typecheck must go green.

## ⚠ PARALLEL UI WORK IN TREE (2026-07-05) — coordinate
Chad has an UNCOMMITTED desktop-UI milestone in the working tree: `apps/local-web/`, `packages/ui/`
(`@vynel/ui`), `.claude/journal/2026-07-05-desktop-ui-m1.md`, `docs/module-notes/desktop-ui.md`, + config
(vue-demi allowBuilds, vitest.workspace web project, eslint, .gitignore, package.json, pnpm-lock/workspace).
**Backend commits in the finish-everything pass stage ONLY backend files explicitly (no `git add -A`)** so his
UI work stays intact/uncommitted for him to handle. Combined gate is green. See memory `ui-fresh-design-no-v1-porting`.

**Guardrails that held (for the next autopilot):** main loop owned diff-check + full gate + code-reviewer +
commit; subagents did heavy file work on the main tree (no worktrees); never committed on red; STATE every
module. **The API-vertical recipe:** the source `apps/api/src/routes/{feature}` already exist with KLONE-
identical conventions → faithful PORT + rewire + `x-sdk-name` + `pnpm api:generate`, NOT invention.
**Full plan + the session architecture: `docs/module-notes/session.md`.**

**The keystone is SMALLER than STATE assumed.** The source already did its hard refactor (B0–B2b: SessionSink,
global-root twin collapsed, global-root runner relocated) and **dropped the "one generic runner" goal** as
wrong-shaped. So the pull is a faithful move of already-refactored, scope-specific code — NOT a grand unifier.

**Architecture (owner-confirmed): `@vynel/session` = parent of chat; the turn service returning stream|response.**
`session → chat`/`orchestration`/continuity, all down; chat + orchestration are continuity-FREE (verified) →
**continuity ∈ session is cycle-free**. Monitor was CUT by Chad (removed the one entanglement). The migration
plan's "continuity in core" was a monolith-only cycle artifact decomposition removes. Features (schedules/channels)
decouple turn-firing (outbox / injected dep), never import the runner up (invariant #2).

**`@vynel/session` Slice 1 is DONE — committed `4e12297` (local, unpushed).** Created the package + folded in
the `continuity` concern (13-file logic, byte-faithful) + did the **`root → primary` rename** (table
`primary_sessions`, all identity types/fns/files; filesystem `rootDir` untouched). **Migration folded into the
`0000` baseline** (Chad's call — pre-release/zero-data → edit baseline+snapshot, no rename migration; sets that
precedent). Green: drizzle "No schema changes", parity 30, vitest 1162. Journal
`.claude/journal/2026-07-04-session-slice1.md`.

**Slice 2a is DONE — committed `8118d24` (local): the global-root runner CORE** (`run-global-root-turn-core`
+ `SessionSink` + `root-turn-lock` + `global-root-instructions`) + `session-mode` + the **web-safe 3-surface
barrel** (`.`=mode · `./runtime` · `./continuity` — constraint #1 satisfied). Exposed `markDelegationsSurfacedToRoot`
from the `@vynel/orchestration` barrel (catch-up write-back). Primary rename applied to the runner. Green (vitest
1170), reviewer CLEAN, diff-proven faithful.

**Slice 2b is DONE (commit pending) — the workspace turn machinery.** Lifted into `runtime/`: `start-chat-turn`
(workspace runner) · `run-seeded-swap-session` · `resolve-primary-conversation` · `apply-primary-turn-continuity` ·
`bridge-primary-session-after-turn` · `compose-session-capabilities` (+ `vynel-agent-instructions`) ·
`test-support/fake-ai-agent-provider`. **The MCP "fork" resolved itself** — `compose-session-mcp-servers` +
`resolve-global-root-conversation` + `global-root-workspace` STAY at the apps/api edge (LOCKED `api-side-turn-execution-with-mcp`
/ env-coupled — injected via `resolveTarget`; the 2a core already takes opaque `mcpServers`). **`start-chat-turn`'s home
INVERTED the old plan** (it imports continuity → can't live in continuity-free chat; the monolith cycle dissolves).
New surface: `@vynel/chat/repositories`. Green (typecheck 48 · parity 30/7/8 · vitest 1182, +12) · faithfulness
diff-proven · reviewer COMPLETE. Full as-built: `docs/module-notes/session.md`.

**The `@vynel/session` PACKAGE is now complete** (2a global-root core + 2b workspace machinery + resolvers + composers
+ continuity). **Slice 3 (app-wiring) is DEFERRED until `apps/api` lands:** the SSE sinks
(`streams/{chat-turn,global-root-turn}`), the `delegate-to-*` compositions, `run-delegation-claim-and-run-tick`,
`wrapAppRequestWithOrigin`, the ③ agent-turn MCP binding, `approvals` completion (fold + decouple the `chat→approvals`
seam). **Until then, pick the next module (Chad's call):** the improve queue (`capabilities` vertical-slice → `approvals`
→ `agents` → `files`) or more leaves (`skills`/`channels`/`schedules`).

**Then — Slice 3 (app wiring, when `apps/api` lands):** the SSE sinks (`streams/{chat-turn,global-root-turn}`),
the `delegate-to-*` compositions, `run-delegation-claim-and-run-tick`, origin-wrap. **The ③ agent-turn MCP
binding** rides here (`composeSessionMcpServers` → `startChatSession({ mcpServers })`; desktop-control is the
working `McpFeatureDescriptor` reference; knowledge/memory/chat each still owe one). **`approvals` completion**
(fold + decouple the `chat → approvals` lazy-import seam) pairs with the runners — the injection point
(`start-chat-turn`) arrives in Slice 2. **b-lead owner-forks (later):** event-vocab unification; approval Fork 2
(`surface-up`). Deferred Layer-B vocab: `globalRootSessionId`/`rootSessionId` fields rename when these land.

## ✅ Recently done (most recent first)
- **`@vynel/marketplace` vertical + API (autopilot — LAST remaining leaf)** — table-less leaf (flat), install-
  status coupling to skills DECOUPLED via injection: `MarketplaceDeps.listInstalledSkills` injected by the
  ROUTE (composition point imports `@vynel/skills`); leaf is PURE (deps=contracts/db/errors, zero skills import).
  2 GET routes → SDK `client.marketplace.*`; NO x-mcp (reads = join of already-exposed skills tools). Route
  test's real skills-install is `withHomeDir`-isolated. Gate **1462**; reviewer CLEAN.
  `.claude/journal/2026-07-04-marketplace-pull.md`. **🏁 ALL 5 REMAINING LEAVES DONE (voice·skills·channels·
  schedules·marketplace).**
- **`@vynel/schedules` vertical-slice + DECOUPLE (autopilot, Chad priority #2)** — last big leaf. Schema
  (schedules+schedule-runs) + repos + logic, folded (`lifecycle/firing/queries/rendering`). Decouple:
  `startChatTurn` INJECTED via `FireScheduleDeps` (structural); `ChatTurnEvent`→contracts; **hub reads
  (`getWorkspaceById` owner-checked)→kernel repos, reproduction byte-identical, owner-check intact**; tick
  + cross-feature integration test DEFERRED. **BOTH KINDS ARE FAITHFUL** — source already does one-time
  (`fireAt`+`ONE_TIME_CRON_SENTINEL`, fires-once-disarms) vs recurring (cron); no `scheduleKind` column
  needed (contracts deliberately use the sentinel). drizzle **"No schema changes"**; gate **1412**; reviewer
  CLEAN. **Still owed: workspaceId-nullable scope + schedules CRUD API.** Deferred improve: explicit
  `scheduleKind` column (Chad's call). **scope+API DONE** (`a786cbe`): workspaceId nullable (baseline-folded,
  tenant-safe null-fire path — reviewer-confirmed no regression); 8 CRUD routes (fire-now DEFERRED to Slice-3),
  SDK `client.schedules.*` (8), MCP 3 reads; create exposes BOTH fireAt+cron. Gate **1426**; reviewer CLEAN.
  `.claude/journal/2026-07-04-schedules-pull.md`.
- **`@vynel/channels` vertical-slice + DECOUPLE (autopilot, Chad priority #1)** — new leaf owning channels
  schema (4 tables) + repos + logic, folded (`lifecycle/senders/queries/inbound/delivery/adapters`).
  **First coupled leaf → real decoupling** (invariant #2): `resolveApproval` now INJECTED via
  `ProcessInboundDeps` (structural, like runRootTurn); `ChatTurnEvent` rewired to `@vynel/contracts/chat`
  (verified no Date/string bug); poll-tick runners (`run-channel-{polling,delivery}-tick`) DEFERRED to
  app-wiring (orchestration precedent). Tests converted `vi.mock`→injection, assertions unchanged. drizzle
  **"No schema changes"**; gate **1380**; reviewer CLEAN; zero sibling-leaf runtime import. **Still owed:
  workspaceId-nullable scope improve + channels CRUD API.** `.claude/journal/2026-07-04-channels-pull.md`.
- **`@vynel/skills` vertical-slice (autopilot)** — new leaf owning skills schema+repos+logic, folded
  memory-style (`schema/`·`repositories/`·`lifecycle/`·`settings/`·`queries/`·`internal/`). Schema+repos
  git-mv'd from kernel; logic from source `core/src/skills/`. Leaf-clean (kernel+shared+contracts+
  providers type-only; NO cross-leaf). drizzle **"No schema changes"**; full gate **1311 passed / 4 skip**
  (+70); reviewer CLEAN. Killed the stale `@vynel/core/skills` index header. **Marketplace read-seam:**
  skills publishes `listInstalledSkillsForUserAndWorkspace` for marketplace install-status.
  **API vertical DONE** — ported the 8-route skills surface (source `apps/api/src/routes/skills`, KLONE-
  identical conventions → faithful port) to `apps/local-api`; SDK `client.skills.*` (8) + MCP 2 read tools;
  serializers omit host path; added `@vynel/skills/test-support` (`withHomeDir`) so route tests don't clobber
  real `~/.claude/skills`. Gate **1323**; reviewer CLEAN. `.claude/journal/2026-07-04-skills-pull.md`.
  **KEY MISSION LEARNING:** source `apps/api/src/routes/{skills,channels,schedules}` ALREADY exist with
  KLONE-identical conventions → every API vertical is a faithful PORT + rewire, not an invention. Source has
  NO cli (net-new). API-vertical scope = routes+schemas+serializers+colocated tests+`api:generate`+parity;
  **CLI deferred mission-wide** (a nicety; not UI/parity-critical).
- **`@vynel/voice` leaf pulled (autopilot warmup)** — stateless voice-relay core (ack-library,
  audio-segmenter, barge-in, relay-task-notifier, sentence-buffer, summarize-turn-for-voice,
  turn-taking-gate, wake-word) moved byte-faithfully from `core/src/voice/`; owns no tables; sole dep
  `@vynel/providers` (type-only `NormalizedSessionEvent`). Flat (no fold, correct). No HTTP surface.
  Green — full gate **1241 passed / 4 skipped** (+48); reviewer CLEAN; byte-faithful proven.
  `.claude/journal/2026-07-04-voice-pull.md`.
- **Approval queue HTTP surface in `apps/local-api` (`f2d7db2`)** — the first user-scoped routes: `GET
  /approvals/pending` (→ `listPendingApprovalsForUser`, the global queue) + `POST /approvals/:providerApprovalId/decide`
  (→ `resolveApproval`; 404/409 via global onError). Responses CAST from `@vynel/contracts` `ApprovalRequestResponse`
  (+nullable `workspaceId`) per the approvals convention; regen'd SDK (`client.approvals.listPending()`/`.decide()`,
  9 paths/10 methods); **no x-mcp** (sensitive path). Green (typecheck · parity · vitest 1193, +7 route tests). This
  completes the approval story's backend→API; only the notification UI (Chad's frontend) + the `SessionSink`
  notify-not-deny seam (deferred to the runners' consumers) remain. `docs/module-notes/approvals.md`.
- **files / workspaces / agents concern-fold — via a parallel Workflow (`5517f1e` + `a5d84ff` + `a899f93`)** — folded
  the flat logic of all 3 packages into concern folders (files: `path/`+`operations/`+`activity/`; workspaces:
  `lifecycle/`+`directory/`; agents: `lifecycle/`+`session/`) using a **Workflow pipeline: 3 fold agents (parallel) →
  3 code-reviewer passes** (6 agents, 0 errors). All behavior-neutral (plain-`mv` + import rewires, zero logic change),
  all reviews CLEAN, gate green (vitest 1186). Shared vocab (`*-types`/`*-events` + persona classifiers like
  `manager-name`, `file-content-kind`→operations) placed by cohesion per the approvals pattern. **Fold sweep now
  complete** except borderline `capabilities`/`provider-preferences` (6 files each — "acceptable flat" per the reviewer).
  Journal `.claude/journal/2026-07-04-workflow-fold.md`.
- **`@vynel/approvals` — global approval-queue backend + concern-fold (Chad's "approval" module)** — **concern-fold
  `a719521`** (the flat `src/` logic → `rules/` [evaluate/describe/save/soft-delete/purge] + `requests/`
  [record/resolve/recover/purge]; shared events/types/derive-action-kind at root; git-mv + rewire, green 1186).
  **A `0fe8192`**
  vertical-slice (schema+repos kernel→package, drizzle "No schema changes"); **B (commit pending)** the global-queue
  data layer: `approval_requests.workspaceId` nullable (baseline-folded) so brain/global-root cards PERSIST (were
  dropped — the stuck-card root cause); `listPendingApprovalsForUser` (user-scoped global pending); `resolveApproval`
  user-scoped (`workspaceId` dropped from the contract, userId-only guard) so a brain card can be ANSWERED, not just
  time out. Green (drizzle "No schema changes", vitest 1186, +4); reviewer MUST-FIX (half-widened resolve) CLOSED.
  Backend only — routes/UI/`SessionSink` seam wait on `apps/api` (Chad chose "backend foundation" scope; the seam's
  **notify-not-deny for top-level** decision is recorded). `docs/module-notes/approvals.md` +
  `.claude/journal/2026-07-04-approvals-backend.md`.
- **`@vynel/session` Slice 2b — the workspace turn machinery `9825f68`+`87a6868` (local)** — lifted `start-chat-turn`
  (workspace runner) + `run-seeded-swap-session` + `resolve-primary-conversation` + `apply-primary-turn-continuity` +
  `bridge-primary-session-after-turn` + `compose-session-capabilities` (+ `vynel-agent-instructions`) +
  `test-support/fake-ai-agent-provider` into `runtime/`. MCP composer + global-root resolver + `global-root-workspace`
  STAY at edge (locked/env — injected `resolveTarget`). New `@vynel/chat/repositories` subpath. `start-chat-turn`'s
  continuity dep INVERTS the old "belongs to chat" plan (chat is continuity-free → the monolith cycle dissolves).
  Green (typecheck 48 · parity 30/7/8 · vitest 1182, +12), reviewer COMPLETE, faithfulness diff-proven.
  `docs/module-notes/session.md` + `.claude/journal/2026-07-04-session-slice2b.md`.
- **`@vynel/session` Slice 2a — global-root runner core + web-safe barrel `8118d24` (local)** — pulled
  `run-global-root-turn-core` + `SessionSink` + `root-turn-lock` + `global-root-instructions` + `session-mode`;
  split the package into `.`(web-safe mode) · `./runtime` · `./continuity`; exposed `markDelegationsSurfacedToRoot`
  from `@vynel/orchestration`. Green (vitest 1170), reviewer CLEAN, faithful. Improve tracked: fold collect+mark
  into one `surfaceDelegationReportsForRoot` op. `docs/module-notes/session.md`.
- **`@vynel/session` Slice 1 — continuity foundation + `root→primary` rename `4e12297` (local)** —
  created the keystone package; folded the 13-file continuity logic + git-mv'd its schema/repos from kernel
  (`primary_sessions`); renamed the durable-session-identity concept `root→primary` (filesystem `rootDir`
  untouched). Migration FOLDED INTO the `0000` baseline (Chad's call — pre-release/zero-data). Green: drizzle
  "No schema changes", parity 30, vitest 1162. Architecture: continuity ∈ session, cycle-free (chat+orchestration
  continuity-free); monitor CUT. Journal `.claude/journal/2026-07-04-session-slice1.md` + `docs/module-notes/session.md`.
- **orchestration vertical-slice + fold `c5e0622` (pushed)** — new `@vynel/orchestration`
  (delegation engine); schema+repos git-mv'd from kernel, logic foldered (`leaf`/`agents`/`records`/`queries`/`routing`),
  `resolve-delegation-trace` EXCLUDED (→ session/monitor tier → keeps orchestration chat-free; only cross-dep = `agents`,
  by-design). Behavior-neutral (drizzle "No schema changes"), gate green (typecheck 43 · parity 30 · vitest 1133),
  faithfulness diff-proven. `AgentDefinition` SDK type-dep flagged (type-only; possible improve = re-export via `@vynel/agents`).
  Journal `.claude/journal/2026-07-04-orchestration-pull.md` + `docs/module-notes/orchestration.md`.
- **chat vertical-slice + fold `1568e91`** (pushed) — new `@vynel/chat` (turn
  engine + persistence + history CRUD); schema+repos git-mv'd from the kernel, logic foldered
  (`turn-consumption`/`records`/`history`/`context`), the `start-chat-turn` runner EXCLUDED (relocates to
  session → keeps chat continuity-free). Behavior-neutral (drizzle "No schema changes"), gate green (typecheck
  41 · parity 30 · vitest 1091). Code-reviewed, no blockers. `chat → approvals` lazy-import seam deferred to the
  session pull (paired with approvals' fold). Journal `.claude/journal/2026-07-04-chat-pull.md`.
- **memory vertical-slice + concern-fold `9213dfe`** — memory now owns `schema/`+`repositories/` (moved from
  kernel) + foldered `indexing/queries/lifecycle/session`. Proven pure relocation (drizzle "No schema changes",
  parity 30, symmetric-rename diff). **This is the TEMPLATE** for the remaining improve queue.
- **Improve queue (one-by-one, vertical-slice + fold owed):** `capabilities` (smallest) → `approvals` →
  `agents` → `files` (largest). Audit confirmed NO real architecture violations across the 8 leaves; hubs
  (`workspaces`/`provider-preferences`) correctly keep schema in kernel — don't slice them.
- **Project `code-reviewer` agent created** (`.claude/agents/code-reviewer.md`) — Vynel-tuned, reviews the
  CURRENT codebase vs the vision (leaf-owns-schema, folders, invariants, vertical-slice purity, house-pattern
  vs real-violation). Invoke by name on any diff/move. **Policy call pending (Chad):** bare `Error` for
  internal invariant guards is the house pattern — sweep to typed `InvariantError` codebase-wide, or leave.

## ✅ PROVIDER SEAM LANDED (base shape) — DONE (ledger)
**`@vynel/providers` is DONE + green** (full record: `docs/module-notes/providers.md`). Pulled the AI-seam
runtime (67 files) and restructured the old flat `claude/internal/` into **knowledge-style concern folders**
under `claude/`: **`base/`** (SDK adapter — `claude-agent-sdk.ts` is the SOLE non-test SDK import site + the
raw-SDK-shape fns; an Anthropic changelog change lands here) · `session/` (drive `query()`) · `approvals/`
(permission wiring) · `history/` (persisted reads) · `installation/` (host install/config). `shared/` stays
the SDK-free provider-agnostic contract → a future `codex/` slots in as a sibling. Gate green: typecheck (17
pkgs) + parity (30/7/7·8) + vitest **670 / 4 skip** (providers 23 files / 142 tests). **NOT wired to anything
yet — by design.** Shape saved to memory (`providers-structure`).

**✅ provider-preferences DONE + green** → new **`@vynel/provider-preferences`** (preferences ONLY:
`find`/`get`/`set` default provider; `get` folds in **Claude as the default** via `DEFAULT_PROVIDER_ID`).
Split the old `core/src/providers/` grab-bag by concern (Chad: "preference is not skills") — skills-discovery
+ provider-status ops **left in the old repo** for their own domains. Full record: `docs/module-notes/provider-preferences.md`.

**✅ 8 LEAVES via 2 PARALLEL FAN-OUT WAVES (2026-07-03)** — all faithful package pulls (logic+tests;
schema+repos stay in kernel for now), each by a worktree agent + code-reviewed (all PASS, faithfulness
diff-verified), gate green at each integration. Suite **677 → 1019** (+342).
- Wave 1 `631ceb2` — `capabilities` · `files` · `memory` (vec/FTS live) · `approvals`. Journal:
  `.claude/journal/2026-07-03-leaf-fanout.md`.
- Wave 2 `ae985bb` — `mcp-contract` · `desktop-control` · `contracts` · `agents`. Journal:
  `…-leaf-fanout-wave2.md`. **`contracts` now landed** (Zod schemas by domain, wildcard subpath exports) →
  unblocks skills/channels/schedules/marketplace. **`mcp-contract` landed** → the ③ binding's contract is in.
- **Blocker analysis result:** `config`/`pubsub`/`queue`/`feature-flags` are empty UNUSED stubs — NOT blockers,
  skip until a real consumer needs them.
- **Fan-out GOTCHA (see memory `worktree-fanout-isolation`):** an agent's `isolation:"worktree"` can silently
  not take → it runs in the MAIN tree and moves HEAD to its branch. **Always `git checkout -f main` +
  verify HEAD==main before integrating.**

**⏭ NEXT (keep fanning out + build the keystone):**
1. **More leaves** (contracts is ready now): core-extractions `skills` (~30 files, incl.
   `discoverInstalledSkillsForProvider`), `channels`, `schedules`, `marketplace`, `voice` (check each for
   `pubsub`/`queue` needs — pull those stubs only if a real consumer appears).
2. **`@vynel/session`** — the composition keystone. **Build in ONE focused session** (Chad), NOT fanned out.
   The ③ agent-turn MCP binding + real approval CARD ride on it + `mcp-contract` (now landed). **FOLD
   candidate:** SDK `tool()` `annotations` for the auto-card model.
- **Serial follow-ups for the 8 landed leaves:** the **vertical-slice** (schema+repos kernel→package, full
  knowledge shape) + **routes/sdk/mcp** (high-collision shared surfaces). **provider-status** ops land with the
  provider routes. `users` core-decomp (then `@vynel/core` disappears). Improve-pass: agents' SDK type-dep,
  `xa11y-adapter.ts` (305 lines). "instructions" domain — later (Chad).
- **Deferred FOLD (providers):** audit-adopt new SDK surface through the base — session helpers
  (`listSessions`/`getSessionInfo`/…), `startup()`, `Query.reinitialize()`, new hook events, `dontAsk`/`auto`
  permission modes. Each deliberate, each with a test. Details in `docs/module-notes/providers.md`.

Everything below this line is DONE (context, not to-do).

---

## ⏵ AUTOPILOT UPDATE (overnight 2026-07-02) — knowledge scope + sources
Chad ran an overnight autopilot (full log: `.claude/ceo/memory/autopilot-mission.md`). Landed on
`main`, green + pushed:
- `251e1e2` refactor(core): drop errors + knowledge re-export shims (one import name per package).
- `de11714` refactor(knowledge): group ops into `indexing/queries/lifecycle`.
- `bbb87bc` feat(knowledge): scope + sources source-model **backend** — new `knowledge_sources`
  registry (workspace/global scope); documents gain `sourceId` + `scope` (workspace_id nullable);
  migration `0038` is **data-preserving + behavioral-tested** (`packages/db/src/migrate-knowledge-sources.test.ts`
  seeds a populated old-shape DB → migrates → asserts FTS + vec still return); all repos + core ops
  reworked to the source model (**global-fused search**, watcher-by-source, auto-registered workspace
  source). Design: `docs/module-notes/knowledge-scope-sources.md`.
- `65b3025` feat(knowledge): sources CRUD core ops + path-safety (`registerKnowledgeSource` /
  `removeKnowledgeSource` / `listKnowledgeSources`).
**Gate:** `pnpm test` green — **86 files / 521 tests (4 skip)**, verified directly.

**⏵ KNOWLEDGE STAGE-2 — DONE + green (this session). Knowledge is now user-facing complete.** Add-directory
made user-invocable end-to-end: `FileWatcherService` wired into the local-api DI (boot singleton owned by
`server.ts` — created at boot, `stopAll()` on shutdown, held on `c.var.fileWatcher`; `createApp` makes an
inert default so the generators keep calling `createApp({db,logger})`). 3 routes under
`/workspaces/:id/knowledge/sources`: `POST` (add_to_knowledge), `GET` (list_knowledge_sources), `DELETE`
(remove_knowledge_source). **Auto mode (Chad): the 2 mutating tools expose via MCP with
`x-mcp.mutatingApproved:true` — NO approval card yet** ("we will have the approval improved"). Regen → SDK 7
paths / 8 namespaced methods, MCP 7 tools. CLI: `knowledge add-directory <path> [--global]` / `sources` /
`remove-source <id>`. **Fixed a generator bug** (namespaced-SDK POST-body needed `NonNullable<…requestBody>`
— add-to-knowledge was the first POST-with-body). Golden tests updated (MCP now asserts tool *names*, per the
old follow-up) + 4 new CLI tests. Gate green — 86 files / **528 tests**, parity 30 · mcp · sdk. **Still
deferred to the session/approvals phase:** the ③ agent-turn MCP binding + the actual approval CARD.
**Chad to verify the live flow** (boot local-api, `vynel knowledge add-directory <real dir>`).

**Then the mission continues: PROVIDER → memory** (Chad's order). Agents stall on long runs here (>~9 min) —
keep agent tasks small or do it directly.

**NO DATABASE EXISTS YET (all clean — confirmed by Chad).** No data / no dev `.db` anywhere → the
migration squash was trivially safe (a baseline is just "the schema, once"; no reconciliation). Autopilot
ended; now INTERACTIVE with Chad (he decides forks).

**⏵ SQUASH — DONE + committed `6740f81` + pushed.** The 39 migrations + `meta/` → one hand-verified
`0000_baseline.sql` (drizzle-kit generated → FTS5/vec0/trigger DDL for all three search domains
hand-appended). **Faithfulness PROVEN**: a throwaway oracle dumped a semantic fingerprint (per-table
columns/FKs/indexes via PRAGMA, order-independent; exact text for triggers + virtual tables) of the OLD
39-chain and the NEW baseline — **semantically identical** (30 tables, 5 virtual, 26 shadow, 9 triggers).
Moot `migrate-knowledge-sources.test.ts` → `migrate-baseline.test.ts` (baseline shape + FTS + vec KNN
across chat/memory/knowledge). Dangling `00xx` comments swept. **Erased the `0038` rebuild risk.** New
schema changes after the baseline still need incremental migrations.

**⏵ VERTICAL SLICE — DONE + committed `481ab3e` + pushed + ✅ BLESSED by Chad ("exactly what we need").**
The relocation LANDED GREEN: knowledge's `schema/` + `repositories/` moved from `@vynel/db` into
`packages/knowledge/` (whole domain now reads in ONE tree). 51 files (12 git-mv renames + 39 edits); all 34
importers rewired (33 internal → local, 1 surface → `@vynel/knowledge`); kernel root schema barrel cleaned;
drizzle config carries one cross-package path (`../knowledge/src/schema/*`); parity guard reworked to walk
every `packages/*/src/schema` root. **Tool-proof:** `drizzle-kit generate` → **"No schema changes"**. Gate
green — 524 tests, parity 30 · mcp · sdk, typecheck 24/24. Re-verified post-bless (tree clean, invariants
hold: knowledge imports down-only, no apps/ imports, kernel dirs clean).
- **knowledge is now the TEMPLATE** every future module copies (`packages/<feature>/{schema,repositories,
  +logic}`). Migration *apparatus* stays centralized (one-physical-DB invariant) — a feature owns its schema
  **files** + logic, NOT its migration lifecycle.

**⏵ LOCAL-API RENAME — DONE + green (this session).** `apps/api` → `apps/local-api`, `@vynel/api` →
`@vynel/local-api` (git-mv + full repo sweep: 5 code refs incl. the 2 generator `createApp` imports, ~30
comment/doc path refs, `.env.example`, generator templates; regen kept SDK/MCP consistent). WHY: this one
always runs on the tenant's machine — the **server-level api** (Phase 2) comes later as a separate app. Gate
green — 524 tests, parity 30 · mcp · sdk. **The architecture principle Chad affirmed:** one core function
serves api actions AND cli actions (and the future server-api) — surfaces are thin peers over one core;
sometimes you want the HTTP hop (server-api), sometimes not (local cli).

**⏵ CLI DIRECTION — RESOLVED by Chad: keep api for now, preserve the shape.** "On cli for now use api no
issues but keep that shape we can use in cli directly if needed in future." So `@vynel/cli` stays over
`@vynel/sdk` → HTTP → local-api for now (NO rewrite). The vertical slice already preserves the db-direct
option (core ops take `db`; the worker proves it) — so a future swap to CLI-db-direct is a drop-in when
needed. Open-when-we-do-it Q (deferred): who runs migrations for a standalone CLI (on-open vs assume-migrated).

**⏵ WORKSPACE PULL — DONE + green (this session).** `packages/core/src/workspaces/` (14 ops + events +
types + tests) → **new `@vynel/workspaces` package**. **Hub, not leaf:** its `workspaces` TABLE + repos STAY
in the kernel (`@vynel/db/schema|repositories/workspaces`) — every feature FKs to workspaces, so moving the
table would force cross-feature imports; only the **management logic** moved. Clean move (zero `../` sibling
deps; the logic only reaches kernel repos + `@vynel/errors`); 2 consumer imports rewired
(`apps/local-api` factory + workspace-resolver: `@vynel/core/workspaces` → `@vynel/workspaces`); dep added to
local-api. Gate green — 524 tests, parity 30 · mcp · sdk, typecheck. **This starts decomposing `@vynel/core`**
(now holds only `users` + `_shared`); `users` is the next hub (same pattern), then core disappears.
**Template refined:** *leaf* feature owns schema+repos+logic; *hub* entity (users, workspaces) keeps
schema+repos in the kernel, only logic → package.

**NEXT (mission order): PROVIDER pull** → `@vynel/providers` (the AI seam; `claude-agent-sdk` runtime ONLY
here). Chad's directive: check ALL old provider functions against the latest SDK, cover all available
functions (drop none), then fold. Big module — step-by-step WITH Chad. Then **memory** (+ tagging system).
Smaller pending: knowledge **Stage-2** routes + workspace CRUD routes (surface work); `users` core-decomp.

## Goal
Rebuild Vynel in KLONE by moving tested code from the old KAFI repo **module-by-module** into a clean
modular monolith (**routes-over-packages on Hono** — logic in `@vynel/<feature>` packages, thin api).
Land each feature's **backend** surfaces (api → generators/sdk/mcp → cli/external-mcp → worker) using
**knowledge** as the reference pattern. **Skip web** (Chad reworks it). Green at every step; commit+push each.

## Repos & branch
- **Working:** `E:\KLONE\Workspace\vynel` — git `main`, remote `github.com/kafijunior/vynel-beta`. This session (all pushed):
  `6740f81` squash · `481ab3e` vertical-slice · `048eaab` local-api rename · `56d163e` postgres notes ·
  `c637526` workspace pull · `592e01b` knowledge Stage-2 · (+ docs). Tip advances with each commit.
- **Source (READ-ONLY, never modify):** `E:\KAFI\WORKSPACE\v2\vynel`, branch `refactor/session-library` (tip `754615f`, clean tree). Pull with:
  `git -C /e/KAFI/WORKSPACE/v2/vynel archive refactor/session-library <paths> | tar -x -C /e/KLONE/Workspace/vynel`
- Backups: `E:\KLONE\vynel-backups\*.bundle`.

## Done (green + committed + pushed)
1. **Scaffold** `291622b` — docs + CLAUDE.md + `.claude/{ceo/soul,rules}` + root config.
2. **Knowledge vertical** `0491192` — `@vynel/db` (ALL domains' schema/repos/migrations) + errors, logger, embeddings, indexer, testing, knowledge.
3. **Knowledge api (Step A)** `51c7c20` — `apps/local-api` trimmed to the knowledge route + `@vynel/core` **spine-slice** (users, workspaces, errors, knowledge, _shared).
4. **Generation pipeline (Step B)** `4764700` — `@vynel/scripts` (generators + 3 parity guards) + `@vynel/sdk` (flat `createVynelClient`) + `@vynel/mcp` **producer shell**. `pnpm api:generate` → flat SDK (5 paths) + MCP registry (4 knowledge tools). **AI-seam invariant amended** (agent-SDK *runtime* stays in providers; the SDK's *builder exports* + Vynel's `McpFeatureDescriptor` are allowed in the MCP layer). Deferred to the providers/composer move: `mcp-contract`, `build-in-process-server`, the descriptors, the external adapter (`server.ts`/`env.ts`).
5. **Namespaced SDK (Step C)** `36088b8` — letterman's `client.knowledge.search()` facade: `describeRoute` widened for `x-sdk-name`, the 5 knowledge routes annotated, `generate-namespaced-sdk` (parse/tree/emit) → `packages/sdk/src/generated/namespaced.ts`, composed via `Object.assign` in `createVynelClient`; `SdkError` on non-2xx. sdk-parity now guards `namespaced.ts`.
6. **Response schemas (B)** `a98fc02` — the 5 knowledge routes declare response schemas (`resolver()` on each 200); `Serialized*` types derive from them via `z.infer` (one source, −50 lines). SDK returns are now **typed** (`client.knowledge.search()` → `{ results: […] }`), flat + namespaced. `expectTypeOf` guard per route.
7. **CLI (D)** `77bddc8` — `@vynel/cli`: `vynel knowledge <search|list|get|status|reindex> -w <id>` over the namespaced SDK (`commander`; thin, injectable `buildProgram` for tests; `env.ts` for base URL; `SdkError`→stderr+exit). Verified `--help` end-to-end.
8. **Worker (F)** `d9c6c45` — `@vynel/worker`: faithful pull (env/factory/scheduler) + `index.ts` trimmed to the single `generate-knowledge-embeddings` cron job (node-cron; thin `(db,logger)`→core delegator). Dropped transitive `@vynel/embeddings` + the empty-registry outbox job.
9. **External MCP (E)** `b2842e3` — `@vynel/mcp` external stdio server (`@modelcontextprotocol/sdk`): reads `@vynel/sdk`'s `openapi.json` at boot, registers each `x-mcp.exposed` route (runtime OpenAPI→Zod), dispatches via `fetch` → direction ②. Advisor-vetted **runtime** (no new generator/parity, can't drift); mirrors ③'s curation. `VYNEL_API_URL` env; boots clean; verified real spec → 4 reads.
**Gate:** `pnpm install` exit 0 · `turbo typecheck` all green · `pnpm test:parity` (schema 29 · mcp · sdk) · `vitest` 513 passed / 4 skipped. **Full `pnpm test` green.**

## NEXT: providers/composer move (direction ③ — a later FEATURE pull)
The knowledge feature's backend surfaces are ALL landed (api → generators → SDK flat+namespaced typed →
MCP registry → external MCP ② → CLI → worker). The one remaining MCP piece is **direction ③** (agent-bound):
pull `packages/mcp-contract` + `apps/mcp/build-in-process-server.ts` (`createSdkMcpServer`) + the
`McpFeatureDescriptor` wrappers, and wire them into the apps/local-api turn composer (`composeSessionMcpServers`).
This needs the `packages/providers` layer, so it's the natural next FEATURE pull, not a knowledge slice.

## The 3 MCP directions (Chad's "be smarter" ask) — from studying letterman
One OpenAPI source → flat SDK + namespaced SDK + MCP registry. **① CLI** over the namespaced SDK · **② external MCP**
via `@modelcontextprotocol/sdk` stdio (tools call the API via fetch+bearer) · **③ agent-bound MCP** via `createSdkMcpServer`
(in-process; Vynel already has it). Reference = `E:\GROWTH HACKING V2\letterman` (Hono; routes + `x-sdk-name`/`x-mcp` →
generators; MCP exposes reads + safe creates, withholds destructive = matches the approval model). `E:\GROWTH HACKING
REBUILD\letterman` = Express "modules" — REJECTED (see `docs/decisions/api-routes-over-modules.md`).

## The per-module loop (`.claude/rules/build-discipline.md`)
Capture Chad's advice/gaps in `docs/module-notes/<module>.md` → git-archive package(s) from session-library →
trim/rewire un-pulled imports (rewiring `@vynel/core` shims → direct packages is the deferred "improve" polish) →
`pnpm install` + `turbo typecheck` + `vitest` GREEN → journal (`.claude/journal/`) → **prompt Chad to commit**
(conventional; **NO AI identity**).

## Gotchas
- **Flaky vitest workspace-resolution (Windows):** a stale vite/vitest transform cache can throw a bogus
  `packages/<pkg>/src/vitest.config.ts`-not-found **startup** error, intermittently, under high collection
  load. A CLEAN test file "breaking" *workspace-config resolution* is NEVER a real code bug — don't bisect for
  a culprit file (it fingers an innocent one by coincidence). Fix: clear the vite cache / re-run; foldering
  test files off a package `src/` root also helps. Ate real time on the chat pull.
- **pnpm 11.0.0 build-gate:** ONLY `allowBuilds: <dep>: true` silences `ERR_PNPM_IGNORED_BUILDS` — `false` and
  `ignoredBuiltDependencies` do NOT. Every build-script dep is `true` in `pnpm-workspace.yaml`; add new ones `true`.
  **Follow-up: bump pnpm to 11.9+** (fixes it → then unneeded native builds can be skipped).
- The api still imports `@vynel/core/{users,workspaces,errors,knowledge}` shims — faithful; rewire-to-direct is later.
- **`scripts` is a workspace entry** in `pnpm-workspace.yaml` (`- "scripts"`) — without it `@vynel/scripts` deps
  (`openapi-typescript`) don't install and `pnpm api:generate` fails `ERR_MODULE_NOT_FOUND`.
- **Improve-pass follow-ups** (deferred, from code reviews): repoint dead doc-citations in pulled comments —
  generator/SDK files **and the worker** (`env`/`factory`/`scheduler`/delegator cite `docs/foundation.md`,
  `blueprint.md §13`; factory's stale "first app to wire pino" claim + `purge-deleted-chat-sessions` examples
  reference un-pulled domains); split `generate-mcp-tools.ts` < 300 lines + drop banner dividers; strengthen the
  MCP golden test to assert tool names, not just count.
- `vitest.workspace.ts` trimmed to the node project (web re-added when `apps/web` lands).
- **Knowledge feature gaps to BUILD** (`docs/module-notes/knowledge.md`, Chad's advice, after the pipeline lands —
  it's a schema change): scope = **workspace OR global**; user **adds directories** to index; **add-to-knowledge is an
  MCP tool** ("add this to my knowledge base").

## Chad's standing directives
Skip web (he reworks it) · backend/background first · **he'll review the whole codebase after the first package fully
lands** (api + generators/mcp/cli) · he advises per module · commit = NO AI identity · prompt before commit.
