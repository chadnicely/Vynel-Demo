# 2026-07-02 — knowledge vertical (first pull)

**Moved** (via `git archive` from KAFI `refactor/session-library`@`754615f` → KLONE):
`@vynel/db` (all-domain schema/repos/migrations), `errors`, `logger`, `embeddings`, `indexer`,
`testing`, `knowledge`. Plus tooling: `tsconfig.base.json`, `vitest.config.ts`, `vitest.workspace.ts`,
`eslint.config.js`, `drizzle.sqlite.config.ts`.

**Gate:** `pnpm install` EXIT 0 · `turbo run typecheck` 13/13 · `vitest run` 421 passed / 4 skipped
(2 pre-existing docx/pdf parser skips). Parity deferred — no `scripts/` or api routes yet.

**Adapted / improved:**
- `vitest.workspace.ts` trimmed to the `node` project (apps/web re-added when pulled).
- `pnpm-workspace.yaml` build-approval: pnpm 11.0.0 does **not** honor the old repo's
  `allowBuilds: <dep>: false` cleanly, and `pnpm exec`/`run` re-invoke `install` first — so the build
  gate blocks *everything* until `install` exits 0. Fixed with `allowBuilds: { better-sqlite3: true,
  esbuild: true, protobufjs: true }` (+ one `--force` to re-apply). protobufjs's build is a benign no-op.
- Dropped the `scripts` workspace entry (re-add when `scripts/` is pulled).

**Learned:**
- Pulling the whole `@vynel/db` brings **all** domains' schema/repos/tests — the entire data kernel
  came green in one move, not just knowledge's slice.
- `knowledge`'s real deps are only `db`/`embeddings`/`errors`/`indexer`/`logger` — **no `@vynel/core`
  shim, no contracts/config.** The session-library extraction is clean.
- pnpm 11.0.0's build-gate is finicky; bumping to 11.9.0 later is worth considering (Chad's call).

**Next:** the knowledge scope + add-directories + add-to-knowledge-MCP enhancement
(`docs/module-notes/knowledge.md`), or `memory` (reuses `embeddings`).
