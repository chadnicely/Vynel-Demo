# Vynel — current state (RESUME HERE)

**Updated 2026-07-04.** After a compaction read this first, then `CLAUDE.md` → `docs/architecture.md` + the
memories (`vynel-vision-and-old-project-lesson` = the founding vision + old-project scatter we must NOT
repeat; `vynel-rebuild-plan`; `worktree-fanout-isolation`). State lives on disk, not chat.

## ⏭ NEXT ACTION (for Chad's return, 2026-07-04): the AUTOPILOT MISSION IS COMPLETE — pick up the deferred app-wiring
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
- ⏳ next: channel ticks · schedule fire-tick + fire-now (wire the keystone into FireScheduleDeps) · CLI · cleanups.

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
