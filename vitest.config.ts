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
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
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
