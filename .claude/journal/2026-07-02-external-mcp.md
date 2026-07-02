# 2026-07-02 — external MCP adapter (E, direction ②)

A generic external **MCP server over stdio** in `apps/mcp`: reads `@vynel/sdk`'s committed
`openapi.json` at boot, registers every `x-mcp.exposed` route as a tool (Zod input built at runtime
from the route's params), and dispatches each call to the api over HTTP (`fetch`). Provider-neutral via
`@modelcontextprotocol/sdk@1.29`. This is **direction ②** of the 3 MCP directions.

**The design decision (advisor-vetted): runtime-generic, NOT codegen.** Direction ③ (agent-bound) is
generated + parity-guarded because its tools are consumed in-process as static typed TS. Direction ②
is a standalone process whose whole job is to call the api over HTTP — codegen's rationales (static
per-tool types, the app-request spec-walk trick, drift risk) don't transfer. So E **reads the committed
spec at runtime**: no new generator, no new parity guard, and it CANNOT drift (the spec is already
regenerated + guarded by `check-sdk-parity`). Write-once-generic — every future `x-mcp` route appears
automatically, no per-feature work.

**Built:**
- `packages/sdk/package.json` — exports `"./openapi.json"` so `apps/mcp` imports the committed spec
  (`import spec from '@vynel/sdk/openapi.json' with { type: 'json' }`).
- `apps/mcp/src/env.ts` — Zod `API_URL` (the one `process.env` read; stdio ⇒ no PORT). Phase-1
  local-user posture (the api resolves the user server-side).
- `apps/mcp/src/external-mcp-server.ts` — `collectExternalTools(spec, dispatch)` (pure + testable:
  walks `x-mcp.exposed` routes → `{name, description, inputSchema, annotations, handler}[]`, sorted) +
  `buildExternalMcpServer(spec, dispatch)` (registers them on an `McpServer`). Includes a runtime
  OpenAPI→Zod builder + the fetch handler (path/query/body from args → dispatch → text result;
  non-2xx / throw → `isError`).
- `apps/mcp/src/external-server.ts` — the executable (`vynel-mcp` bin): loads env, imports the spec,
  builds a fetch dispatcher (`fetch(new URL(path, API_URL))`), connects `StdioServerTransport`. Status
  to stderr (stdout is the MCP channel).
- `apps/mcp/src/index.ts` — re-exports the external builder (apps/mcp is now a real MCP surface, not
  just the Step-B producer shell).
- Tests: fixture spec + capturing dispatch — curation (exposed + approved-mutating only), GET
  URL/query building, POST JSON body, non-2xx → isError.

**Curation MIRRORS direction ③** (`generate-mcp-tools.ts`): only `exposed === true`; a mutating tool
requires `mutatingApproved` (defense-in-depth — the committed spec only carries routes that passed ③'s
gate). The runtime OpenAPI→Zod builder parallels ③'s `openApiToZodSource` (string-emitter there,
object-builder here) — intentional ~30-line parallel, blessed per "simplicity over DRY-that-contorts"
with a cross-reference comment. Did NOT pull KAFI's `server.ts` (the confused agent-SDK/fetch hybrid);
this is a native `McpServer`.

**Gate:** `turbo typecheck` · `pnpm test:parity` (schema/mcp/sdk) · `vitest` **512 passed / 4 skipped**
(+5 external-MCP tests). **Verified end-to-end** against the REAL committed spec: it produces exactly
the 4 knowledge read tools (search / list / get / status) with correct inputs; `reindex` (no x-mcp)
excluded — matching ③'s curation.

**Code review (Gate 3): PASS, zero must-fix, 2 should-fix (both applied).** The reviewer independently
confirmed ②'s tool set matches ③'s generated registry (same 4 reads) and verified the dispatch /
`registerTool` / stdio discipline / safety baseline. Applied:
- *SF-1* — renamed env `API_URL` → `VYNEL_API_URL` (matches the CLI; a bare `API_URL` risks collision
  with a generic var in an MCP host's environment, silently redirecting tool calls).
- *SF-2* — added an input-schema test: the runtime OpenAPI→Zod builder (`buildInputShape`/`openApiToZod`)
  had no coverage; extended the fixture with enum / nullable / array params and assert
  required-vs-optional + per-branch `safeParse` behavior.
Reviewer notes accepted as-is: the curation divergence (③ *throws* on an unapproved mutating route, ②
*continues*) is fail-safe + unreachable for any spec `check-sdk-parity` permits; `z.unknown()` (vs ③'s
`z.any()`) + the stricter all-strings enum guard are improvements.

**Verified the executable boot path** (the reviewer flagged it as ungated): `vynel-mcp` boots clean —
env loads, the `with { type: 'json' }` spec import resolves at runtime, tools register, stdio connects,
exits 0 on stdin EOF.

**Now 2 of the 3 MCP directions ship from one OpenAPI source:** ② external stdio (this) + the ③
agent-bound registry (generated in Step B, awaiting its providers consumer). **Remaining:** the
providers/composer move wires ③ to its real consumer (`packages/mcp-contract` +
`build-in-process-server.ts` + the `McpFeatureDescriptor` wrappers + `createSdkMcpServer` +
`composeSessionMcpServers`).
