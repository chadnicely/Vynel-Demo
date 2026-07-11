import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

// The `cloud-admin-web` project of the root vitest.workspace.ts —
// DOM-environment tests for the hub admin portal.
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    name: "cloud-admin-web",
    include: ["src/**/*.test.ts"],
    environment: "happy-dom",
    passWithNoTests: true,
  },
});
