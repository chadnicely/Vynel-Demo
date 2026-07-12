import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

// The `local-web` project of the root vitest.workspace.ts — DOM-environment
// tests for the desktop web app (components, stores, env parsing).
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Same rationale as the root node project: DOM tests stall under
    // full-suite parallel load (lazy imports, happy-dom setup) — seen as
    // one-off flakes always green in isolation.
    testTimeout: 20_000,
    name: "local-web",
    include: ["src/**/*.test.ts", "env.test.ts"],
    environment: "happy-dom",
    passWithNoTests: true,
  },
});
