# skills vertical-slice — `@vynel/skills` (2026-07-04)

Second module of the remaining-leaves autopilot. First VERTICAL-SLICE of the mission (sets the
recipe for channels/schedules).

## What landed
New leaf `@vynel/skills` owning its schema + repositories + logic, folded memory-style:
- `schema/` (installed-skills, skill-settings) · `repositories/` (same + tests) — git-mv'd out of the
  kernel (`@vynel/db/{schema,repositories}/skills`).
- `lifecycle/` (install · uninstall · enable · disable · synchronize-skills-with-provider) ·
  `settings/` (resolve · update) · `queries/` (list-available · list-installed-for-context ·
  list-installed-for-user-and-workspace) · `internal/` (on-disk fs/render/mcp-config helpers) ·
  `skills-events`/`skills-types`/`index` at root.
- Logic pulled from source `core/src/skills/`; schema+repos git-mv'd from KLONE kernel.

## Deps / invariants
- Leaf imports only kernel + shared + `@vynel/contracts` + `@vynel/providers` (**type-only**
  `AiAgentProvider`, in synchronize-skills-with-provider). NO cross-leaf imports. Clean.
- `@vynel/providers` is a runtime `dependency` (not dev) because `AiAgentProvider` leaks into the
  exported `SynchronizeSkillsWithProviderInput` public surface.
- Outbox atomicity holds across every mutating op (install/enable/update/synchronize each co-commit
  `insertOutboxEvent` in one `withTransaction`); FS writes are deliberately disk-first, outside the tx.

## Kernel wiring
- `drizzle.sqlite.config.ts`: skills schema paths → `../skills/src/schema/*` (cross-package, like
  chat/memory/knowledge).
- `packages/db/src/schema/index.ts`: dropped the `./skills/index.js` barrel export.
- Parity auto-walks `packages/*/src/schema` — no guard edit.

## Gate
- Behavior-neutral PROVEN: `drizzle-kit generate` → **"No schema changes, nothing to migrate"** (twice,
  independently).
- Full `pnpm test` green — **1311 passed / 4 skipped** (+70 new logic/internal tests; the ~30 repo
  tests already ran in the kernel).
- `code-reviewer`: CLEAN, zero must-fix. Killed the one stale-residue defer-note in the same move
  (`src/index.ts` header no longer says "core layer / `@vynel/core/skills`").

## Seam note for marketplace
`index.ts` publishes `listInstalledSkillsForUserAndWorkspace` with a comment: marketplace's
install-status annotation reads THIS (not the skills repo directly). That's the skills→marketplace
read seam — decide inject-vs-import at the marketplace step.

## API vertical — DONE (faithful port)
Ported the 8-route skills surface from source `apps/api/src/routes/skills/` → `apps/local-api`
(`/workspaces/:workspaceId/skills`): `available`·`installed` (read, x-mcp) + install·uninstall·
enable·disable·settings·synchronize (mutating, NO x-mcp — safe-by-default, faithful). Rewired
`@vynel/core/skills`→`@vynel/skills`. **The source routes use IDENTICAL conventions to KLONE's
local-api** (it was seeded from apps/api) → port, not invent. Added `x-sdk-name` to all 8 (KLONE's
namespaced-SDK generator throws without it). `pnpm api:generate` → SDK `client.skills.*` (8) + MCP
2 read tools (registry 7→9). Golden tests updated (+skills namespace, +2 tool names).
- **Data-loss save:** the source route test wrote to & DELETED the real `~/.claude/skills/email-drafter/`.
  Added `@vynel/skills/test-support` (re-exports the existing `withHomeDir` seam, embeddings precedent);
  route tests wrap install/uninstall in a tmp home. Verified the real skill untouched.
- Serializers omit `installLocation` (host path) + `userId`. Reviewer CLEAN; gate **1323 passed**.
- Defer: `/synchronize` resolves provider inline (`resolveAiAgentProvider('claude')`) not via `c.var` —
  faithful-acceptable; improve = inject provider via c.var (also de-hardcodes 'claude' + makes it testable).
- **CLI deferred** (mission-wide: CLI is a nicety, not needed for UI/parity — batched at the end or per STATE).
