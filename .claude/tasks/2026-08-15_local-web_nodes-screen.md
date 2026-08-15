# Task: Land the Nodes screen
**Plan:** [[nodes-screen-pull]]
**Project:** local-web
**Created:** 2026-08-15
**Status:** pending

## Objective

Bring Chad's Nodes screen onto main: the `Nodes` word in the title bar beside `View`, and the
constellation it opens — canvas scene, the three readings (Nodes / Grid / Race), the drill from the
fleet into one project's sessions, and the empty-state invitation.

His UI lands as he drew it. The plumbing is rebuilt to main's rules, which means two of his
composables are **not** ported: `useSetupState` (`setupCompletedAt`) and `useWorkspaceLevels`
(`parentWorkspaceId`) both read workspace-schema fields main does not have, and `Pick<>` against a
missing key is a hard typecheck error. The fleet lists every non-archived workspace instead, and the
centre orb reads `Vynel` at fleet level.

Named `nodes`, not `mission-control` — the click and the code now say the same word. Race stays
binary exactly as he built it; real progress needs phase/feature tracking that does not exist yet.

## Files Involved

**New — ported faithfully**
- `apps/local-web/src/utils/constellation-scene.ts` — the canvas engine (zero imports)
- `apps/local-web/src/utils/constellation-layout.ts` + `.test.ts`
- `apps/local-web/src/composables/tasks/task-queue-summary.ts`
- `apps/local-web/src/composables/workspaces/use-workspace-progress.ts`

**New — ported with the two rewires**
- `apps/local-web/src/views/NodesView.vue` (his `MissionControlView.vue`)
- `apps/local-web/src/views/nodes-view.test.ts`

**Modified**
- `apps/local-web/src/stores/ui-store.ts` (+ `.test.ts`) — `nodesMode` + the create-workspace bell
- `apps/local-web/src/router.ts` — the `nodes` route
- `apps/local-web/src/components/shell/AppTitleBar.vue` (+ `.test.ts`) — the `Nodes` button
- `apps/local-web/src/components/shell/AppShell.vue` — `case "open-nodes"` + watch the bell

**After green (Gate 2)**
- split `NodesView.vue` (763 lines) — Grid and Race extract cleanly
