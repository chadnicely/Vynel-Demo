# View modes — Nodes | Display | Normal switch + the full view

*Worktree `.claude/worktrees/view-modes` · branch `feature/view-modes` · band 18950 (engine 18952,
local-web 18954). Brief from Kafi, 2026-08-22 (two screenshots). Code-complete the same day.*

## The ask

1. A three-icon switch — **Nodes | Display | Normal** — in the title bar, just **left of the Claude
   mark** (the account popup's door). Shaped like a game HUD widget, not a plain segmented pill.
2. A **full view** for Nodes and the Display: the chrome steps out and the view fills the window;
   the switch + window controls stay top-right over the view's own top strip.
3. **Normal view stays exactly as it is today.**

## Decisions (Kafi, 2026-08-22)

| Fork | Call |
|---|---|
| Sidebar in full view | **Hides too** — a true takeover (the tab strip goes with it). |
| The `Nodes` word in the menu bar | **Retired** — the switch's Nodes segment is the one door. |
| The Display segment | **Show + voice on** — it IS the voice switch now; the Broadcast glyph is retired (its `toggle-display` command survives for the palette). Pressed again in the room = off (the old glyph's close). From another view while the voice runs it JOINS the conversation rather than hanging up. |
| Full view | **A separate toggle** (the plate's trailing expander, only on Nodes/Display). Sticky for the session, not persisted — like `nodesMode`. |

## Shape as shipped

```
viewMode   = route === "nodes" ? "nodes" : isDisplayActive ? "display" : "normal"   (derived, no new state)
isFullView = ui.isFullView && viewMode !== "normal"
```

| Piece | Where | Note |
|---|---|---|
| Derivation | `composables/shell/use-view-mode.ts` | takes the shell's one `isDisplayActive` (the toggle composable announces to the dock — called once) |
| The plate | `components/shell/ViewModeSwitch.vue` | chamfered hex plate: outer box carries the `drop-shadow` glow, `.rim` + `.plate` share one `clip-path` polygon (a clipped box cannot cast its own shadow); `data-skin="display"` only in the Display's full view |
| Title bar | `AppTitleBar.vue` | props `viewMode` / `fullView`; full view = `absolute right-0 top-0` corner cluster (mark, menus, tasks glyph gone); wears `.display-palette` over the Display so the cluster paints in its palette |
| Shell | `AppShell.vue` | `.app-shell.full-view { grid-template-rows: 1fr; --chrome-inset-right: 268px }`; sidebar + tab strip `v-if … && !isFullView`; commands `view-display` → `pickDisplay()`, `view-normal` → `returnToNormalView()`, `toggle-full-view`; palette gained "Go to Nodes" + "Toggle full view" |
| Toggle verbs | `composables/display/use-display-toggle.ts` | `leaveDisplay()` (restore the tab's pre-Display view, voice untouched — the OFF path reuses it) and `pickDisplay()` (reads `ownsVoice` BEFORE `showDisplay`, since showing the room is itself one way the Display comes to own the voice) |
| Store | `stores/ui-store.ts` | `isFullView` ref, session-only |
| The views' top strips | `DisplayView.vue` (`.strip`), `NodesFleetBar.vue` | `:data-tauri-drag-region="ui.isFullView \|\| undefined"` — bound, because Tauri honours the attribute whenever it is in the DOM (the title bar is gone in full view, something has to drag the window) + `padding-right: var(--chrome-inset-right, 0px)` so the cluster never covers their right end |

## Review fixes (code-reviewer, 2026-08-22)

- Normal from Nodes goes through `selectSurface("chat")`, not a raw route push — a room parked on
  the global tab (Display → Nodes → Normal) came straight back as the chat route landed.
- `toggle-full-view` is ignored on the normal view — the palette could arm the sticky flag invisibly.
- The plate's `drop-shadow` filter lives on the Display skin only (no compositing layer for a
  transparent glow). Deferred: `--chrome-inset-right` is hand-measured (268px); a ResizeObserver-fed
  var if the cluster ever changes width.
| Palette | `packages/ui/src/display/display-root.css` | the seven `--display-*` vars now live on `.display-root, .display-palette`; the ground stays on `.display-root` alone |

## Verified

- Vitest (local-web, all 149 files / 1209 tests) green; `@vynel/ui` + `local-web` typecheck green; eslint clean.
- Browser pass on band 18950 (playwright): normal bar unchanged but for the plate before the mark; Nodes
  shows the expander; Nodes full view = fleet bar as the top row with the cluster beside its counts;
  Display full view = the strip as the top row, cluster in cyan; Normal restores the chrome with the
  Display segment still lit while the voice runs behind.

## Owed by Kafi (the live smoke, in the Tauri shell)

Full view in the real window: drag the window by the Display strip / the fleet bar; minimise / maximise /
close from the corner cluster over the Display; the light theme on the Nodes full view; the plate's
glow on a real DPR > 1 screen.
