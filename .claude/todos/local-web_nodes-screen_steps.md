# Todo: Land the Nodes screen
**Task:** [[2026-08-15_local-web_nodes-screen]]
**Plan:** [[nodes-screen-pull]]
**Project:** local-web

## Steps

### Port (faithful)
- [x] Copy `constellation-scene.ts` verbatim — zero imports, self-contained rAF engine
- [x] Copy `constellation-layout.ts` + its test verbatim
- [x] Copy `task-queue-summary.ts` verbatim
- [x] Copy `use-workspace-progress.ts` verbatim (compiles — `lastMessageAt` shipped in task 1)

### Store + routing
- [x] `ui-store.ts`: `nodesMode` + the create-workspace bell
- [x] `ui-store.test.ts`: three cases (default reading, it survives, the bell counts each ring)
- [x] `router.ts`: the `nodes` route (`/` → `home` left alone)

### The view
- [x] Port → `NodesView.vue` with only the rewires that cannot compile
- [x] Port its test → `nodes-view.test.ts` (4 cases, incl. an archived room is not a dot)

### Shell wiring
- [x] `AppTitleBar.vue`: the `Nodes` word beside View, in main's own trigger classes
- [x] `AppTitleBar.test.ts`: pins the third nav button + that it emits `open-nodes`
- [x] `AppShell.vue`: `case "open-nodes"` + the bell watcher

### Gates
- [x] Targeted typecheck + vitest green
- [x] **Gate 2** — split `NodesView.vue` 741 → 269 lines
- [x] Re-verify green after the split — **723 tests / 108 files passing**
- [ ] `code-reviewer` on the whole diff
- [ ] CHANGELOG + commit

## Things found along the way (not in the original plan)

- **Main had migrated off Lucide to Phosphor.** `lucide-vue-next` is not even a dependency any
  more — 68 files import `@phosphor-icons/vue`. The two icons swapped to main's own aliasing house
  style (`PhCaretLeft as ChevronLeft`, `PhPlus as Plus`).
- **The API change had a second caller.** `routes/root/index.ts` shares
  `ContinuingConversationResponseSchema`; adding the field to only one route would have made the
  generated SDK type lie. Both now return the same shape.
- **ESLint `eqeqeq`** rejected Chad's `!= null` idiom. Rewritten by hand, never `--fix` (auto-fix
  would rewrite it to `!== null` and silently stop catching `undefined`).
- **`task-queue-summary.ts` shipped with no test.** Since its booleans were the thing the eqeqeq
  rewrite touched, it got one — 10 cases pinning every branch.

## Split result

| file | lines |
|---|---|
| `views/NodesView.vue` | 269 |
| `components/nodes/NodesFleetBar.vue` | 188 |
| `components/nodes/NodesGrid.vue` | 88 |
| `components/nodes/NodesRace.vue` | 85 |
| `components/nodes/NodesInvitation.vue` | 79 |
| `composables/nodes/use-fleet-nodes.ts` | 73 |
| `composables/nodes/use-project-nodes.ts` | 69 |

`utils/constellation-scene.ts` stays 652 — one frame loop over shared mutable buffers; the why is
commented at the top, and its testable seam already lives in `constellation-layout.ts`.
