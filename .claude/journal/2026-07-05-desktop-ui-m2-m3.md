# 2026-07-05 — desktop-ui M2+M3: demo data layer + chat experience + rich tool cards

## What landed

- **The demo seam** (`apps/local-web/src/demo/`): fixtures typed by `@vynel/contracts`, an
  in-memory `demoStore` (the stand-in DB — finished turns write back, so vue-query's
  invalidate-and-refetch behaves exactly like production), hand-written `client.workspaces` /
  `client.chat` namespaces attached to the real SDK client, and `chat-turn-player` — a scripted
  `ChatTurnEvent` stream with a real approval-gate (pauses until decided, walks
  approved/denied branches, interruptible).
- **Letterman data layer**: per-domain key factories + one composable per operation;
  `active-turn-view.ts` as the pure transport-blind fold; `use-chat-turn` orchestrates (demo
  player today, the SSE reader drops in at Slice-3).
- **Global Chat end-to-end**: sessions panel (+error state), thread with history, live turn
  (gold cursor/working chip), composer (send/stop), Application drawer.
- **Approvals-as-notifications**: `ApprovalNotifier` in the shell polls the REAL
  `/approvals/pending` every 5s — decidable toast cards on any view; titlebar presence dot goes
  gold-ring on pending, gold-pulse while a turn runs (activity store).
- **Rich tool cards** (Chad's Claude-desktop reference, mid-session ask): `tool-presenters.ts`
  (pure) + `CodeBlock.vue` (lazy shiki, dual light/dark themes via CSS vars, CSS-counter line
  numbers, plain fallback) + reworked `ToolCallCard` (Read→highlighted file with line numbers,
  Edit→before/after diff, Bash→terminal, unknown→payload panes) + `ToolCallList` grouping
  consecutive runs ("Read 2 files").

## Key learnings

- **markdown-it (`html:false`) escapes hostile HTML to text** — the XSS test must assert
  semantically (no script/img ELEMENTS), not string-match "onerror" against escaped content.
- **`vue/comment-directive` must be enabled** for template `<!-- eslint-disable -->` comments to
  work at all — the flat/recommended spread we use doesn't include it.
- **`exactOptionalPropertyTypes` + Vue props**: shared-lib optional props want `| undefined` so
  consumers can forward their own optionals.
- **Keep `@vynel/ui` icon-free**: caught myself adding lucide for a chevron — inline SVG instead;
  the module-notes rule held.
- **Sync prefix of async orchestrators is a real API**: `startTurn` resolves the session before
  its first await, so the view can bind/select the new session immediately — no flash.

## Verified

vue-tsc + tsc green (both packages) · 43 tests / 12 files · eslint zero problems · prettier
clean · full browser drive: send → thinking → Read/Grep stream in → approval card (exact diff
input) → approve → Edit/Bash run → final answer → persisted thread with expandable highlighted
tool cards; zero console errors. Reviewer (M2/M3 scope): CLEAN, should-fixes applied same-session.

## Next

M4 Workspace tab (switcher, per-workspace sessions, drawer feature sections over the REAL
skills/channels/schedules/knowledge/marketplace SDK, files panel shell) → M5 Home dashboard →
M6 Tauri shell + Jarvis overlay. Slice-3 asks recorded in module notes (approval `actionKind` on
the turn event; `listSessions` shape adaptation).
