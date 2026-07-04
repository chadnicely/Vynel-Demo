# 2026-07-05 — desktop-ui M1: foundation (`@vynel/ui` + `@vynel/local-web`)

## What landed

- **Plan approved** (`C:\Users\KLONE\.claude\plans\curious-wiggling-parasol.md`): Tauri v2 shell
  (vision §9's open call — now LOCKED), fresh-designed 3-tab desktop UI (Home | Chat | Workspace),
  letterman vue-query+SDK data layer, demo-data-first with contracts-typed swap seam. Module notes:
  `docs/module-notes/desktop-ui.md`.
- **`packages/ui`** — shared component library: design tokens (cool slate + ONE gold "presence"
  accent = assistant is alive/needs you; dark default + light) + PresenceDot / SegmentedTabs /
  IconButton / EmptyState. Data-blind, icon-agnostic (slots), vue as sole peer dep.
- **`apps/local-web`** — Vue 3 SPA: Zod `env.ts` boundary (LOCAL_WEB_PORT 8999 / LOCAL_API_URL →
  `/api` proxy), pinia + vue-router + vue-query + SDK client provisioning (`useVynel()` boundary),
  custom titlebar (wordmark + presence dot · segmented tabs · theme toggle), 3 routed views,
  ui-store (theme, sync-flush watcher).
- Root integration: vitest 3 projects (node / local-web / ui), eslint web globs, dev filter,
  vue-demi allowBuilds. 13 tests. Reviewer: **CLEAN** (3 should-fixes applied same-session).

## Key learnings

- **v1's "web view look" was literal** — the old main UI ran in browser chrome; its Tauri shell was
  only the voice pill. The native wrap is exactly what v2's apps/desktop milestone builds.
- **One import idiom repo-wide**: Vite/esbuild + TS all substitute `.js → .ts`, so the house
  `.js`-extension rule holds even in web packages — only tsconfig `moduleResolution: Bundler`
  differs (vue-tsc needs it). No eslint carve-out required.
- **Vue watcher flush**: theme stamping needs `flush: 'sync'` — atomically with state, and it's
  what the store's contract tests assert.
- **Concurrent-session discipline**: a parallel session was mid-edit on user-scoped
  channels/schedules APIs (transient red in packages/schedules); verified the red was foreign via
  file mtimes, scoped my gate to my packages, touched none of their files. Full-repo gate + commit
  wait for their tree to settle.

## Next

M2 — data layer: per-domain key factories + composables (6 real namespaces), demo namespaces
(workspaces/sessions) typed by `@vynel/contracts`, the ChatTurnEvent demo player + `use-active-turn`
folding. Note for M2: the concurrent session is ADDING user-scoped `/channels` + `/schedules` +
global-scope support — regen'd SDK will carry new namespaced methods; build composables against the
regenerated surface, not today's snapshot.
