import { defineWorkspace } from "vitest/config";

// Four projects:
// - `node`      (./vitest.config.ts)              — apps/local-api, apps/worker, packages/**
//                                                   all the server-side TS tests
// - `local-web` (./apps/local-web/vitest.config.ts) — the desktop web app: happy-dom +
//                                                   Vue plugin + `@/` alias
// - `cloud-admin-web` (./apps/cloud-admin-web/vitest.config.ts) — the hub admin portal
//                                                   (happy-dom + Vue plugin)
// - `ui`        (./packages/ui/vitest.config.ts)  — the shared component library (happy-dom)
//
// `pnpm test` (= `turbo run typecheck && pnpm test:parity && vitest run`)
// uses this file at the root to run ALL projects.
export default defineWorkspace([
  "./vitest.config.ts",
  "./apps/local-web/vitest.config.ts",
  "./apps/cloud-admin-web/vitest.config.ts",
  "./packages/ui/vitest.config.ts",
]);
