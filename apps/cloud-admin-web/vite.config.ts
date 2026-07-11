import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 8891,
    strictPort: true,
    // Every client fetch goes to `/api/...`: the future hub-served prod mode
    // mounts the same /api strip in front of cloud-api (the gateway
    // precedent), so dev and prod see identical paths.
    proxy: {
      "/api": {
        target: "http://localhost:8890",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
