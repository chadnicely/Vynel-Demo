# marketplace vertical — `@vynel/marketplace` (2026-07-04)

Last package of the remaining-leaves autopilot. Table-less leaf (like voice) + install-status coupling
to skills, decoupled via injection.

## What landed
New table-less leaf `@vynel/marketplace` (flat — 4 ops + types, smallest-correct, source-1:1):
annotate-with-install-status · filter-marketplace-items · list-marketplace-items · get-marketplace-item.

## Decouple (marketplace → skills, via injection — PURE leaf)
- `annotate-with-install-status` is a pure helper; rewired its `InstalledSkillRow` import to a LOCAL
  structural `InstalledSkillView` (the 5 fields it reads; `scope` via `@vynel/contracts`).
- `listMarketplaceItems`/`getMarketplaceItem` now take `deps: MarketplaceDeps` (`{ listInstalledSkills }`,
  structural) — no skills import. **The ROUTE is the composition point**: it imports
  `listInstalledSkillsForUserAndWorkspace` from `@vynel/skills` and injects it (apps compose leaves).
- Leaf purity PROVEN: `packages/marketplace/package.json` deps = contracts/db/errors only; zero
  `@vynel/skills` import in the leaf (reviewer + grep confirmed).

## API
2 GET routes (source `apps/api/src/routes/marketplace`) → local-api under `/workspaces/:id/marketplace`.
SDK `client.marketplace.{listItems,getItem}`. **NO x-mcp** (faithful — marketplace reads are the JOIN of
skills' already-exposed `list_available_skills`+`list_installed_skills`; re-exposing = redundant).
- Route test drives a REAL `POST /skills/install` for genuine install-status coverage, wrapped in
  `withHomeDir` (skills test-support) — reviewer traced every write path: real `~/.claude/skills` untouched.

## Gate
- Full `pnpm test` **1462 passed / 4 skip** (+36); typecheck; parity (30/14/33). Reviewer CLEAN, zero must-fix.
- Defer-notes: stale old-repo `decisions.md` D-number comment refs; `sortMarketplaceItems` 'recommended'==alpha
  (pre-existing, immaterial); `searchQuery min(0)` no-op.
