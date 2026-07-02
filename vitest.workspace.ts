import { defineWorkspace } from 'vitest/config'

// Two projects:
// - `node` (./vitest.config.ts)        — apps/local-api, apps/worker, packages/**
//                                        all the server-side TS tests
// - `web`  (./apps/web/vitest.config.ts) — apps/web with `happy-dom` +
//                                          the Vue plugin + the `@/`
//                                          alias for component tests
//
// `pnpm test` (= `turbo run typecheck && pnpm test:parity && vitest run`)
// uses this file at the root to run BOTH projects. Per
// `.claude/memory/decisions/apps-web-foundation-design.md`.
// The `web` project (apps/web/vitest.config.ts) is re-added when apps/web is pulled.
export default defineWorkspace(['./vitest.config.ts'])
