# Journal — `@vynel/session` Slice 2b: the workspace turn machinery (2026-07-04)

Landed green + reviewer-COMPLETE (commit pending, local). This closes the `@vynel/session` PACKAGE — 2a
(global-root core) + 2b (workspace machinery + resolvers + composers + continuity-application). Slice 3
(app-wiring) waits for `apps/api`.

## What moved into `packages/session/src/runtime/`
`start-chat-turn` (workspace runner) · `run-seeded-swap-session` · `resolve-primary-conversation` ·
`apply-primary-turn-continuity` · `bridge-primary-session-after-turn` · `compose-session-capabilities`
(+ `vynel-agent-instructions`) · `test-support/fake-ai-agent-provider`. Deps expanded: `capabilities`,
`contracts`, `memory`, `pino`. New surface: `@vynel/chat/repositories`.

## The three decisions that shaped it

1. **The MCP "fork" resolved itself — no owner decision needed.** STATE/the module note framed "does
   `@vynel/session` dep the MCP producers for `compose-session-mcp-servers`?" as an open fork to decide on a
   fresh context. It isn't open: `compose-session-mcp-servers` stays at the apps/api edge — LOCKED
   (`api-side-turn-execution-with-mcp`), APPROVED-shipped (B2a `b796923`), and **already baked into the 2a
   runner core** (it takes opaque `mcpServers: Record<string, unknown>`, imports neither producer). The only
   doc placing it in session was a DRAFT explicitly gated "no code until ratified." **Lesson: a flagged fork
   can be a settled question — check the source's own locked/shipped decisions before putting it to the owner.**

2. **`start-chat-turn`'s home INVERTED the old migration plan — and that's correct.** The plan said it
   "belongs to `core/chat`" citing a `core↔session` cycle. But that cycle was a MONOLITH artifact (old `core`
   bundled orchestration+schedules+chat). In KLONE: `start-chat-turn` imports `captureCompactionSummary`
   (continuity); continuity lives in session; chat is continuity-FREE **by design** (what keeps `session→chat`
   acyclic). So putting it in chat forces `chat→continuity→session` — the INVERSE cycle. Session is the UNIQUE
   home. This is the *same* monolith-cycle dissolution that put continuity ∈ session (Slice 1). Verified
   empirically: nothing in `packages/` imports `start-chat-turn` (orchestration runs its own turns via the
   injected `provider` + `drainLeafTurn`, never through it), so there is provably nothing to cycle.

3. **The seam rule → a principled resolver asymmetry.** Ground-truthed against the shipped edge
   (`run-global-root-turn.ts:138` builds `resolveTarget` = resolve + env-cwd, injected into the 2a core): the
   PACKAGE owns env-free + Hono-free + non-MCP-locked logic; the EDGE owns env reads, SSE/sinks, MCP-producer
   composition, origin-wrap, and INJECTS them. Consequence — the **workspace** resolver lifts (its cwd is a
   workspace-record field) but the **global-root** resolver stays at edge (its cwd is an env read,
   `VYNEL_USER_DATA_DIR`, via `global-root-workspace`). Same `primary_sessions` row; split only by the env seam.

## New surface: `@vynel/chat/repositories`
The lifted `apply-primary-turn-continuity` needs `updateChatSession`; the swap test needs `find`/`insertChatSession`
— all internal to chat after its vertical-slice (barrel-ops only). Exposed the existing 4-file repos barrel via
one `package.json` line — the faithful analog of the old `@vynel/db/repositories/chat` the code imported, and a
legit session→chat down-call (session is the composition tier above chat). SQL stays inside the repos. Reviewer:
"the minimal change; do not upgrade." (A curated `hideChatSession` op is a later intent-revealing improve.)

## Faithfulness method
Archived the byte-faithful source to scratchpad; copied into `runtime/` with target names; applied import
rewires + the `root→primary` rename via surgical edits; then **normalized-diffed** each hand-written impl
against source (sed the identity rename + paths onto source, diff vs landed) → residual diffs were ONLY comment
`root→primary` + two deliberate location-comment fixes. Zero logic/assertion drift. Gate: typecheck 48 · parity
30/7/8 · vitest **1182 (+12)**.

## Deferred improves (reviewer, none block)
Trim the barrel's internal-helper exports (`bridgePrimarySessionAfterTurn`/`runSeededSwapSession`) once Slice 3
reveals the edge's real surface · unify `run-seeded-swap`/`bridge` onto `StructuralLogger` (drop the direct `pino`
dep) · `hideChatSession` op · fold the bare-`Error` guard into the tracked `InvariantError` policy.
