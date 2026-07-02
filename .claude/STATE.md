# Vynel — current state (RESUME HERE)

**Updated 2026-07-02.** After a compaction read this first, then `CLAUDE.md` → `docs/vision.md` →
`docs/architecture.md` → `.claude/ceo/soul.md`. State lives on disk, not chat.

## Goal
Rebuild Vynel in KLONE by moving tested code from the old KAFI repo **module-by-module** into a clean
modular monolith (**routes-over-packages on Hono** — logic in `@vynel/<feature>` packages, thin api).
Land each feature's **backend** surfaces (api → generators/sdk/mcp → cli/external-mcp → worker) using
**knowledge** as the reference pattern. **Skip web** (Chad reworks it). Green at every step; commit+push each.

## Repos & branch
- **Working:** `E:\KLONE\Workspace\vynel` — git `main`, remote `github.com/kafijunior/vynel-beta`, pushed through `b2842e3`.
- **Source (READ-ONLY, never modify):** `E:\KAFI\WORKSPACE\v2\vynel`, branch `refactor/session-library` (tip `754615f`, clean tree). Pull with:
  `git -C /e/KAFI/WORKSPACE/v2/vynel archive refactor/session-library <paths> | tar -x -C /e/KLONE/Workspace/vynel`
- Backups: `E:\KLONE\vynel-backups\*.bundle`.

## Done (green + committed + pushed)
1. **Scaffold** `291622b` — docs + CLAUDE.md + `.claude/{ceo/soul,rules}` + root config.
2. **Knowledge vertical** `0491192` — `@vynel/db` (ALL domains' schema/repos/migrations) + errors, logger, embeddings, indexer, testing, knowledge.
3. **Knowledge api (Step A)** `51c7c20` — `apps/api` trimmed to the knowledge route + `@vynel/core` **spine-slice** (users, workspaces, errors, knowledge, _shared).
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
`McpFeatureDescriptor` wrappers, and wire them into the apps/api turn composer (`composeSessionMcpServers`).
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
