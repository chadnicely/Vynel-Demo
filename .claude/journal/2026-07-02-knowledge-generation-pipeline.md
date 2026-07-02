# 2026-07-02 — generation pipeline (Step B)

One OpenAPI source → a **flat SDK** + an **MCP tool registry**, both derived from the knowledge
route's `x-mcp` annotations and parity-guarded. This activates the **full gate** for the first time:
`turbo typecheck && pnpm test:parity && vitest run`.

**Moved** (git archive from KAFI `refactor/session-library` → KLONE):
- `scripts/` → `@vynel/scripts`: the generators (`generate-sdk`, `generate-mcp-tools`,
  `check-schema-parity`, `check-mcp-parity`) + `package.json` (brings `openapi-typescript`) +
  tsconfig + barrel. Skipped `context-pack.ts`, `debug/`, `migrations/` (not pipeline).
- `packages/sdk` → `@vynel/sdk`: the flat client (`createVynelClient` over `openapi-fetch`).
  The two artifacts (`openapi.json`, `src/generated/api.d.ts`) were **regenerated** from the
  knowledge-only API, not pulled (the source copies described the full old API).
- `apps/mcp` → `@vynel/mcp` **producer shell**: `mcp-types.ts`, `index.ts`, the **regenerated**
  `generated/api-tools.ts` + its golden test.

**Gate:** `turbo typecheck` (all pkgs) · `pnpm test:parity` → *schema-parity 29 files* +
*mcp-parity snapshot matches* + *sdk-parity artifacts match* · `vitest` **485 passed / 4 skipped**
(up from 482; +3 = the trimmed MCP golden test). `pnpm api:generate` → *5 paths* (SDK) + *4 tools* (MCP).

**The invariant amendment (owner-approved, the one real fork).** A faithful move means the generated
`apps/mcp/src/generated/api-tools.ts` imports `tool` from `@anthropic-ai/claude-agent-sdk` — which
tripped the old "Never: import `claude-agent-sdk` outside `packages/providers`." We amended
`CLAUDE.md` (both the prime directive and the Never) to split the concern: the agent-SDK **runtime**
(`query`, the session loop) stays confined to `packages/providers/src/claude/`; the SDK's **builder
exports** (`tool`, `createSdkMcpServer`, `SdkMcpToolDefinition` — all verified real exports of the
installed SDK) carry no runtime and are permitted in the MCP layer, as is Vynel's own
`McpFeatureDescriptor` contract. This doesn't dent provider-agnosticism: direction ③ (agent-bound
MCP) is Anthropic-agent-bound *by definition*; direction ② (external MCP) stays neutral via
`@modelcontextprotocol/sdk`. This move's footprint of the amendment is a **single generated file**.

**Scope — pulled only what has a consumer now (faithful-first).**
- `apps/mcp/package.json` trimmed to the shell's real needs: deps `@anthropic-ai/claude-agent-sdk` +
  `@vynel/db` + `zod`; dev `typescript`. Dropped `@vynel/mcp-contract`, `pino`, `@vynel/testing`,
  `tsx`, and the `dev` script (all belonged to the deferred external adapter / descriptor).
- `apps/mcp/src/index.ts` re-exports `mcp-types` only.
- `generated/api-tools.test.ts` trimmed from the source's 24 + 4 golden set to the knowledge-only
  **4 read-only tools + empty routing** — a faithful trim to current reality.

**Deferred — lands with its consumers** (the apps/api turn composer + `packages/providers`, neither
pulled yet): `packages/mcp-contract`, `apps/mcp/src/build-in-process-server.ts` (`createSdkMcpServer`,
direction ③), `vynel-mcp-feature-descriptor.ts` (the `McpFeatureDescriptor` wrappers), `server.ts` +
`env.ts` (direction ② external adapter — Step E), the integration test.

**pnpm-workspace fix:** the scaffold's `packages:` globbed only `apps/*` + `packages/*`, so
`@vynel/scripts` (at the repo root) was never a workspace project and its `openapi-typescript` devDep
never installed — the generator failed with `ERR_MODULE_NOT_FOUND`. Added `- "scripts"` (matches the
source workspace map); re-install linked it.

**Code review (Gate 3) — `code-reviewer` on the staged diff: 1 must-fix + 8 should-fix.**
Fixed this move:
- *must-fix* — undocumented `m[1]!` in `generate-mcp-tools.ts` given a `// safe:` justification
  (matches the file's other documented escapes).
- *SF-1* — **added `check-sdk-parity.ts`** + wired into `test:parity`. The SDK artifacts have no
  typecheck consumer yet (web/cli deferred), so without it a stale `api.d.ts` self-typechecks and
  drifts silently. This makes "both parity-guarded" genuinely true — it goes one guard beyond the
  source repo, deliberately, to compensate for the deferred web consumer.
- *SF-6* — CLAUDE.md amendment reworded: named the `claude-agent-sdk` runtime as the import subject
  (the "it" was ambiguous), and separated the SDK's builder exports from Vynel's own
  `McpFeatureDescriptor` (a `@vynel/mcp-contract` type, not an SDK export).
- *SF-3* — dropped the unused `@vynel/db` from `scripts/package.json` (reached transitively via
  `@vynel/api`; schema-parity reads `packages/db` via the filesystem, not an import).
- *SF-4* — removed a dead temp-dir (`mkdtempSync`/`rmSync`, never written to) from `check-mcp-parity.ts`.
- *SF-7* — `mcp-types.ts` de-cited (the `/build-domain` + `docs/blueprints` refs the file was pulled
  with); the `McpToolFactory` return stays `unknown` (the SDK-typed narrowing lands with its
  deferred consumer `build-in-process-server.ts`).

Deferred to a deliberate improve-pass (faithful-move residue — cosmetic or pervasive):
- *SF-2* — dangling doc citations in the pulled generator/SDK comments (they point at source-repo
  docs not pulled: `.claude/rules/sdk-mcp.md`, `docs/blueprints/mcp/*`, `decisions.md D1..D12`,
  `/build-domain`, …). Repoint to real in-repo authorities or drop. ~8 files.
- *SF-5* — `generate-mcp-tools.ts` is 381 lines (rule ≤ ~300) + uses `// ----` banner dividers.
  Extract the string-emitters into a sibling `mcp-tool-emit.ts`.
- *SF-8* — the golden test asserts tool **count** only (a rename passing at count 4 slips past it; the
  parity guard catches renames, so it's a canary gap, not a hole). Consider asserting emitted names.

**Next:** Step C — adopt letterman's **namespaced SDK** (`x-sdk-name` → `client.knowledge.search()`).
The KLONE `describeRoute` wrapper today widens for `x-mcp` only, so `x-sdk-name` support (the wrapper
widening + the SDK tree-builder) is genuinely net-new — nothing in this move half-implements it
(reviewer confirmed the diff is clean of namespacing). Then Step D (`apps/cli` over the namespaced
SDK, direction ①).
