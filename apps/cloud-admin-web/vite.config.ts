import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { loadCloudAdminWebEnv } from "./env.js";

export default defineConfig(({ mode }) => {
  const env = loadCloudAdminWebEnv(mode);
  return {
    plugins: [vue()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      port: env.CLOUD_ADMIN_WEB_PORT,
      strictPort: true,
      // Every client fetch goes to `/api/...`: the future hub-served prod mode
      // mounts the same /api strip in front of cloud-api (the gateway
      // precedent), so dev and prod see identical paths.
      proxy: {
        "/api": {
          target: env.CLOUD_API_URL,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
  };
});
