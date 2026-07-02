# 2026-07-03 — provider seam → anti-corruption base

The AI seam lands. `@vynel/providers` — the `AiAgentProvider` contract + the Claude runtime built on
`@anthropic-ai/claude-agent-sdk` — pulled and folded directly into a **single-import base** so the many
future consumers are insulated from SDK drift.

**Moved** (git archive from KAFI `refactor/session-library` → KLONE): the whole `packages/providers/`
(67 files) — `shared/` (the SDK-free `AiAgentProvider` abstract class + 11 types + the active-session /
pending-approval registries), `claude/` (`ClaudeAiAgentProvider` + ~22 `internal/*` helpers: SDK-options
builder, the `canUseTool` approval callback, pre-tool / post-compact hooks, event translation, session
storage/sync, skill discovery, transcript fetch, image handling), `registry.ts`, `test-support/
fake-claude-query.ts`, and the manual `scripts/smoke-subagent-agent-id.ts`. Deps unchanged from source:
`@anthropic-ai/claude-agent-sdk@^0.3.181` (matches `apps/mcp`) + `@vynel/errors` — **no `@vynel/db`**;
the package is a pure runtime seam. `provider-logger.ts` keeps its structural `ProviderLogger` type
(no `@vynel/logger` import). `package.json` aligned to the KLONE convention (`exports`).

**The fold — knowledge-style concern folders + the anti-corruption base (Chad's shape).**
> "Keep the SDK-touching functions in a base… update the specific part. Many packages use this library." +
> "Keep the files under folders like knowledge; keep the shape so we can add codex or any platform later —
> Claude is the only priority now."

The old repo dumped 21 files in a flat `claude/internal/`. We restructured `claude/` into **concern folders
like the `knowledge` package**, keeping the provider-agnostic shape (`shared/` = the contract a future
`codex/` sibling implements):
- `claude/base/` — the SDK adapter. `claude-agent-sdk.ts` is the **sole non-test SDK import site** (re-exports
  `query` + `CanUseTool`/`HookCallback`/`Options`/`SDKMessage`), alongside the raw-SDK-shape functions
  (`build-claude-sdk-options`, `translate-claude-sdk-event`, `claude-sdk-message-readers`,
  `handle-attached-images`). An Anthropic changelog change lands here, one place.
- `claude/session/` (drive `query()`) · `claude/approvals/` (permission wiring) · `claude/history/`
  (persisted-session reads) · `claude/installation/` (host install/config reads).

`shared/` stays 100% SDK-free. The `*.test.ts` files keep `vi.mock('@anthropic-ai/claude-agent-sdk')` at the
real module boundary — the mock flows through the base re-export unchanged (zero test-mock edits). The
refolder rewire was pure path-recompute (same-depth moves → only 21 cross-concern edges changed); tests rode
with their subjects.

**Two corrections from Chad, both honored.** ① Rejected a staged "faithful-as-is copy → then fold" as
valueless ceremony (source was already green + SDK-confined → the restructure *is* the move). ② A first pass
landed as a near-verbatim copy + a thin re-export base and **missed the agreed knowledge-style foldering** —
corrected into the concern-folder structure above; the agreed shape is now saved to memory
(`providers-structure`). `code-reviewer` on the base fold → **PASS, 0 findings** (choke-point confirmed;
`verbatimModuleSyntax` re-export forms correct; `shared/` SDK-free).

**Gate green:** `turbo typecheck` (17 pkgs) · `pnpm test:parity` — *schema 30* + *mcp 7 tools* +
*sdk 7 paths / 8 methods* (all unchanged — providers has no schema/routes) · `vitest` **670 passed /
4 skipped** (providers = 23 files / **142 tests**).

**Not wired to anything yet — by design.** Follow-ons (Chad's order): ① provider-preferences CRUD
(`core/src/providers/*` — the DB-touching consumer; hub table already in kernel) · ② the ③ agent-turn
MCP binding + the real approval CARD (now unblocked; the knowledge mutating tools wait on it) · ③ memory.
**Deferred FOLD:** audit-adopt newer SDK surface *through the base* — session helpers
(`listSessions`/`getSessionMessages`/…), `startup()`, `Query.reinitialize()`, new hook events,
`dontAsk`/`auto` permission modes, `tool()` `annotations` (readonly/destructive → the auto-card model).
Full record + SDK audit in `docs/module-notes/providers.md`.
