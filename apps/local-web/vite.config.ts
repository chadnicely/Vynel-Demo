import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { loadLocalWebEnv } from "./env.js";

export default defineConfig(({ mode }) => {
  const env = loadLocalWebEnv(mode);

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      port: env.LOCAL_WEB_PORT,
      strictPort: true,
      // The local API has no CORS (loopback-only by design) — the dev server
      // fronts it; the SDK client's baseUrl is '/api'.
      proxy: {
        "/api": {
          target: env.LOCAL_API_URL,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
  };
});
