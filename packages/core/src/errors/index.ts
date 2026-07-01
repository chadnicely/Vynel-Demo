// Re-export of the shared `VynelError` taxonomy. The taxonomy itself lives in
// the dependency-free leaf package `@vynel/errors` — extracted there so both
// `@vynel/core` and `@vynel/providers` can import it without a `core <->
// providers` workspace dependency cycle. This re-export keeps existing
// `@vynel/core/errors` importers (the `apps/api` middleware, `users` +
// `workspaces` core ops) unchanged. New code may import `@vynel/errors`
// directly. See `.claude/memory/decisions/errors-package-extraction.md`.

export * from '@vynel/errors'
