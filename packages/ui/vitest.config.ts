import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

// The `ui` project of the root vitest.workspace.ts — DOM-environment
// component tests for the shared component library.
export default defineConfig({
  plugins: [vue()],
  test: {
    name: "ui",
    include: ["src/**/*.test.ts"],
    environment: "happy-dom",
    passWithNoTests: true,
  },
});
