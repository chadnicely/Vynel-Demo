# 2026-07-05 — desktop-ui M4+M5+voice: workspace tab, dashboard, Jarvis demo

## Chad's directives this slice

Complete the UI on demo data — **no real engagement**; real APIs + the stream wiring happen
together later. Commit my files without touching the concurrent API session's. (Also from earlier
in the session: rich Claude-desktop-style tool cards — landed in the previous commit.)

## What landed

- **M4 Workspace tab**: `WorkspaceSwitcher` (persisted `activeWorkspaceId`, outside-click close),
  per-workspace sessions + chat reusing the M3 components (workspace `SessionScope`), `FilesPanel`
  with a recursive demo tree, and the drawer's 7 feature sections (`workspace-sections.ts`
  catalog + `WorkspaceSectionPanel` demo lists typed by the real contracts —
  ChannelResponse/ScheduleResponse/MarketplaceItem/Pick<VerifiedSkillDefinition>; memory/agents
  show honest "on its way" states).
- **M5 Home dashboard**: recent conversations across scopes, workspaces with manager personas,
  upcoming schedules, approvals note — over a demo `dashboard.getOverview()` aggregate namespace
  (proposed as a real Slice-3 route; recorded in module notes).
- **Voice demo (M6-prep)**: `VoiceOrb` in `@vynel/ui` — pure CSS, 6 states (idle/wake/listening/
  thinking/speaking/muted), gold per the presence rule, zero deps — plus `VoiceOverlayDemo`
  (titlebar mic → blurred overlay, scripted beat loop with captions, mute). The Tauri overlay
  window mounts the same orb in M6.

## Reviewer (CLEAN) should-fixes applied

Switcher outside-click close · `activeWorkspaceId` persistence tests (restore/persist/clear) ·
`WORKSPACE_SECTIONS` extracted to `workspace-sections.ts` (panel back under 300 lines). Deferred
(recorded in module notes): dashboard rows preselecting their session, the `workspaceId: "none"`
sentinel → `enabled` gate at swap time.

## Learnings

- Runtime `export`s can't live in `<script setup>` — shared consts belong in a sibling `.ts`
  (cleaner import story than dual-script blocks anyway).
- Fixture unions bite: check the contract's exact union values (`healthy`, not `connected`;
  `installStatus` is an object union) BEFORE writing fixtures — the typecheck drift-guard works.
- Store watchers flush on Vue's scheduler tick — tests await `nextTick()`, not a bare microtask.

## Verified

typecheck 4/4 · 48/48 tests / 13 files · eslint + prettier clean · browser sweep: workspace tab
(switcher, sessions, welcome persona line), drawer sections + files tree together, Home dashboard
(all four cards on demo data), voice orb loop (thinking state screenshotted mid-spin), zero
console errors. Committed separately from the concurrent API session's files.
