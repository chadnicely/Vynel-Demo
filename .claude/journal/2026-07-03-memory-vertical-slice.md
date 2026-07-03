# 2026-07-03 — memory vertical-slice + concern-fold (the improve phase, one-by-one)

First of the "improve" moves Chad flagged (the fan-out did faithful pulls; the vertical-slice + foldering
were deferred). Memory now matches the **knowledge shape** fully.

**Vertical-slice (schema+repos kernel → package):** `packages/db/src/{schema,repositories}/memory/*` →
`packages/memory/src/{schema,repositories}/`. Rewired: moved schema's kernel-FK refs (`../users`/`../workspaces`)
→ `@vynel/db/schema/{users,workspaces}`; moved repos' `../../client`/`../../dialect`/`../../test-support` →
`@vynel/db`/`@vynel/db/dialect`/`@vynel/testing`, local schema → `../schema/*`; memory logic's
`@vynel/db/{schema,repositories}/memory` → local barrels. Kernel: dropped the memory line from the schema
barrel; `drizzle.sqlite.config.ts` memory paths → cross-package (`../memory/src/schema/*`, mirroring
knowledge); memory `package.json` gains `drizzle-orm` (now owns schema/repos that import it).

**Concern-fold:** the 15 flat logic files → `indexing/` (embeddings) · `queries/` (search/list) · `lifecycle/`
(create/update/delete/record-mention/purge/cleanup/derive-title) · `session/` (load-context +
build-contribution — memory's unique session-start concern, the future home of the `context` tag). Root keeps
`index`/`memory-types`/`memory-events`. Tests rode with their subjects; cross-folder import edges recomputed.

**Proven pure relocation (no behavior change):** `drizzle-kit generate` → "No schema changes, nothing to
migrate"; schema-parity **30** (unchanged); diff **74 ins / 74 del** (import-path only) with git-recognized
renames; only shared surfaces touched = drizzle config + kernel schema barrel. Full gate **1019 pass / 4 skip**
(the 36 memory-repo tests relocated db→memory; suite total unchanged).

**Next for memory (Step 2, deliberate schema change):** the tagging system (behavioral `context`/`recall`
enum + open topical tags, seed ~15–20 not 100) + user memory sources (dir/file, mirroring knowledge's
`sources`). Vision + advice captured in `docs/module-notes/memory.md`.

**The pattern is now templated** for the remaining leaves' vertical-slice + fold (capabilities/files/approvals/
agents), one-by-one.
