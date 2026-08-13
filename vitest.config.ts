import { defineConfig } from "vitest/config";

// The `node` project of `vitest.workspace.ts` — every server-side test
// in the repo (apps/local-api, apps/worker, packages/**). The `web` project
// (apps/web/vitest.config.ts) handles DOM-environment component tests
// separately. The two projects run together via `pnpm test` (the
// workspace file does the wiring). Per
// `.claude/memory/decisions/apps-web-foundation-design.md`.
export default defineConfig({
  test: {
    name: "node",
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts", "scripts/**/*.test.ts"],
    // `apps/local-web/**`, `apps/cloud-admin-web/**` + `packages/ui/**` are
    // owned by their DOM-env projects — exclude them here so tests aren't
    // run twice.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "apps/local-web/**",
      "apps/cloud-admin-web/**",
      "packages/ui/**",
    ],
    environment: "node",
    // The argon2id + PGlite suites (accounts, cloud-api) exceed the 5s default
    // under full-suite parallel load — OWASP-parameter hashing is deliberately
    // slow, and worker contention stacks several hashes into one test. Seen as
    // recurring single-test flakes (3× on 2026-07-12, always green isolated).
    testTimeout: 20_000,
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/*.test.ts",
        "**/migrations-*/**",
      ],
    },
  },
});
