# Vynel — current state (RESUME HERE)

**Updated 2026-07-03.** After a compaction read this first, then `CLAUDE.md` → `docs/vision.md` →
`docs/architecture.md` → `.claude/ceo/soul.md`. State lives on disk, not chat.

## ✅ PROVIDER SEAM LANDED (base shape) — next: follow-ons, then memory
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

**⏭ NEXT ACTIONS (Chad's order):**
1. **③ agent-turn MCP binding + the real approval CARD** (`mcp-contract` + `build-in-process-server` +
   `composeSessionMcpServers`) — unblocked by the seam. Knowledge mutating tools wait on this (auto-mode, no
   card today). **FOLD candidate:** SDK `tool()` `annotations` (readOnly/destructive) for the auto-card model.
2. **memory pull** (+ tagging system, ~100 context/rule tags).
- **Split-out follow-ons** (land with their domains, NOT re-homed early): **skills** domain
  (`core/src/skills/*`, ~30 files — incl. `discoverInstalledSkillsForProvider`); **provider-status** ops
  (`getProviderAuthenticationStatus`/`listProvidersWithStatus`/`ProviderRuntimeNotInstalledError`, with the
  provider routes). `users` core-decomp (then `@vynel/core` disappears).
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
