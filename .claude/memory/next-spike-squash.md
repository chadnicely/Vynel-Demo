# NEXT ACTION (do first in a fresh session): the spike + squash

**Greenlit by Chad.** This settles the ONE open foundational decision — how a feature is shaped
(the template EVERY future module copies) — on **evidence, not argument** (I flip-flopped 3× on
rhetoric; the cure is a spike, not another opinion).

## The decision it settles
Should a feature own its `schema/` + `repositories/` co-located with its logic in
`packages/<feature>/` (**vertical slice**), or keep them in the shared kernel `@vynel/db` (**today**)?
Chad leans vertical-slice for the **vision** (self-contained "multiverse" features) + **timing**
(one module = the cheapest reorg we'll ever get; we're squashing anyway). Chad: "it doesn't matter
about the database" → decide on the *foundation shape*, not db-tooling convenience.

## The ONE unknown = the whole ballgame
Does `drizzle-kit` cleanly generate ONE migration set when schema is defined **across feature
packages** — cross-package config paths, FKs resolving to the kernel's `users`/`workspaces`, the
schema-parity guard, one `_journal.json`?
- **Clean → vertical slice wins outright.**
- **Fights the tool → permanent complexity → Chad "can't do complexity" → schema stays in the
  kernel** (and now we have the CONCRETE reason, not "Phase-1 pragmatic").

## The spike (~30 min) — FUSED with the migration squash (one stroke)
1. Relocate `packages/db/src/schema/knowledge/` + `packages/db/src/repositories/knowledge/` INTO
   `packages/knowledge/` (its own `schema/` + `repositories/`). Rewire imports.
2. Point the drizzle config at the feature-package schema; **squash** the 39 migrations → ONE fresh
   baseline generated from that layout. Safe — **NO db file exists anywhere, all clean** — and it
   also erases the risky `0038` rebuild (a baseline just *creates* the final shape). Hand-append the
   FTS5 + sqlite-vec + trigger DDL into the baseline (drizzle-kit doesn't generate those).
3. Run schema/mcp/sdk parity + `pnpm test`. Green → PROVEN + template ready. Red/fights the tool →
   revert the relocation, keep schema in the kernel, squash in the current layout.

## Boundary (do NOT over-scope)
Surfaces — routes (`apps/api`), cli, mcp, worker — **stay thin in `apps/`** regardless. "Vertical
slice" = schema + repos + **logic** in the feature package, **NOT** the routes. That keeps the two-api
future (tenant-local api + server-level api) clean.

## After the spike
If vertical-slice wins → knowledge is the **template**; **fan out agents** to build small modules
(memory / schedules / capabilities / …) each as one self-contained package + verify; **big modules
step-by-step** with Chad. Still pending regardless: knowledge **Stage-2** (add-directory route +
`add_to_knowledge` MCP tool + CLI — needs a `FileWatcherService` wired into the api DI), then the
mission **workspace → provider → memory** (session together).

## Durable state
Knowledge backend green + committed + pushed: `bbb87bc` (source model) · `65b3025` (sources CRUD) ·
`d859256` (docs). `pnpm test` = **86 files / 521 tests**. Full architecture reasoning +
web-verification in `docs/scaffold.md` (§3 deep-dive; §3.5 web-check confirms vertical-slice is a
legit pattern, not "cosmetic"). **Agents stall on long runs (>~9 min) — keep agent tasks small or do
it directly.**
