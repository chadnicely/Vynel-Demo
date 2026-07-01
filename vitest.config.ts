import { defineConfig } from 'vitest/config'

// The `node` project of `vitest.workspace.ts` — every server-side test
// in the repo (apps/api, apps/worker, packages/**). The `web` project
// (apps/web/vitest.config.ts) handles DOM-environment component tests
// separately. The two projects run together via `pnpm test` (the
// workspace file does the wiring). Per
// `.claude/memory/decisions/apps-web-foundation-design.md`.
export default defineConfig({
  test: {
    name: 'node',
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'],
    // `apps/web/**` is owned by the `web` project — exclude it here so
    // tests aren't run twice (once in node env, once in DOM env).
    exclude: ['**/node_modules/**', '**/dist/**', '**/.turbo/**', 'apps/web/**'],
    environment: 'node',
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/*.test.ts', '**/migrations-*/**'],
    },
  },
})
