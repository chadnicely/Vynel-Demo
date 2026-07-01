# Vynel — operating contract (read this first)

Vynel is a **desktop AI assistant for non-technical people** that wraps Claude Code (via
`@anthropic-ai/claude-agent-sdk`) in a trustworthy experience layer: visible memory, curated skills,
an approval card on every irreversible action, channels (Telegram, Voice/Jarvis), scheduled tasks.

**We are rebuilding this repo by moving proven, tested code out of the old project module-by-module
into a clean modular-monolith shape — never a rewrite, never a big-bang.** Read `docs/vision.md`
(what we're building), `docs/architecture.md` (the shape), and `docs/restructure-research.md` (where
the code stands) before writing or moving anything.

---

## Prime directives

- **Modular monolith.** Features are `@vynel/<feature>` packages over one shared `@vynel/db` kernel.
  Imports point **down only** (§1 of architecture.md). No cross-feature imports or FKs — features
  link through **loose refs + the outbox**.
- **Move, then improve.** Bring a module in faithfully, get it green, *then* improve it. One module at
  a time. Test-green at every step. If it's red, stop.
- **Thin surfaces, one core.** All logic in `packages/`. `apps/` (api/web/desktop/voice/worker/mcp/cli)
  are thin adapters and never get imported by packages.
- **The AI seam is sacred.** Reach the runtime only through `AiAgentProvider`. Import
  `claude-agent-sdk` **only** inside `packages/providers/src/claude/`.
- **Everything is a session.** Global / workspace / agent are scopes of one Session primitive.
- **Provider-agnostic, phase-2-ready.** Every user row carries `userId`; every repo is
  dialect-agnostic. Don't write Phase-1 code that must be torn out for Phase 2.

## Architecture invariants (do not violate)

1. `packages/` never import from `apps/`.
2. A leaf imports only the kernel + shared (`errors`/`logger`/`contracts`/`config`). No sibling-leaf
   import, no cross-feature FK — loose-ref + outbox only.
3. One shared `@vynel/db`. No physical per-feature DBs. No raw SQL outside `db/repositories`.
4. No business logic in routes: parse → validate → call core → shape response.
5. Every state change co-commits its outbox event in **one** `db.transaction`.

## Code rules (strict)

- **TypeScript ^5.4, strict, ESM.** `.js` extension on every relative import. No `require`, no
  `module.exports`, no CommonJS.
- **No `process.env` outside each app's `env.ts`** (Zod-validated at boot).
- **Repositories are functional**, `db` first arg, stateless — never class-based. `findX` may return
  null; `getXOrThrow` throws. Classes only for genuinely stateful services (provider runtime,
  registries).
- **Typed errors** (`VynelError` subclasses); one `onError` switch maps them to HTTP.
- **Hono routes are one fluent chain** (RPC type inference depends on it). Every response typed.
- **Naming:** descriptive and precise (discord.js / Stripe-SDK house style). **Banned** standalone:
  `Manager`, `Helper`, `Util`, `Service`, `Handler`, `Processor`; `data`, `info`, `tmp`, `result`.
  Acronyms are words: `McpClient`, `HttpClient`, `AiAgentProvider`.
- **Files ≤ ~300 lines** (tests may exceed). **Functions small, one responsibility.**
- **Comments explain WHY, never WHAT.** No commented-out code. No decorative banners.
- **MCP:** a feature exposes tools by shipping one `McpFeatureDescriptor` — never hand-wire per
  surface. Mutating tools declare `mutatingToolNames` (they auto-card).

## Testing (the gate)

- **Vitest.** Real SQLite temp file via `@vynel/testing` (`withTestDatabase`). **Never mock the DB.**
- Tests colocated (`x.ts` ↔ `x.test.ts`). **Every change ships its tests** — not deferred.
- **The gate is `pnpm test`** = `turbo run typecheck` + schema/MCP parity + `vitest run`. Never bare
  `vitest`. **Never commit on red.**

## Logging & security

- Structured logging via `@vynel/logger`. **No `console.log` in production code.**
- Never log secrets, tokens, or PII. No hardcoded secrets — env vars only. Sanitize user input at
  boundaries. Parameterized queries only.

## Workflow

- **Before a big change: outline the plan, get Chad's okay.** Prefer editing existing code over
  rewriting. Touch only what's necessary; find the minimal professional path.
- **Fixing a bug = root-cause first**, fix, verify, then sweep the codebase for the same pattern.
  Zero new bugs. No lazy/temporary patches, ever.
- After a change: run the gate, then ask Chad to test what you can't. Once verified, **prompt to
  commit + update `CHANGELOG.md`** (conventional commits: `feat/fix/refactor/chore/docs/test`;
  subject < 72 chars; lowercase, no period).
- **Communication:** direct, pair-programmer, thinking out loud. If an approach is wrong, say so and
  why. Lay out trade-offs; recommend, don't just survey. Ask when unclear. Skip preambles.

## Never

- Rewrite from scratch · big-bang moves · physical DB split · import `claude-agent-sdk` outside
  `packages/providers` · swallow errors silently · skip tests to ship faster.
