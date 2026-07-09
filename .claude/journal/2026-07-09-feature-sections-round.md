# 2026-07-09 (evening) — the feature-sections round (channels · schedules · knowledge · memory)

Commits: `9203974` (channels + schedules) · `9178caa` (knowledge + memory). Autonomous finish —
Chad left mid-round with "complete as much as you can, then shut down."

## What shipped

Four scope-aware sections (`components/sections/`, `SectionScope = global | workspace`) on BOTH the
global menu and the workspace drawer, each with a real create flow: connect Telegram (BotFather
walkthrough, Discord honestly "coming soon"), create once/repeating schedules (click-time fireAt or
built cron via the pure `schedule-cadence` util), add knowledge folders (real directory browser),
add memories (the API's real kinds). Empty states invite the first item.

## Learnings

- **The fake-client seam hides wire-contract bugs.** The schedule dialog's Once path was green in
  every test yet 400'd against the real API: the `reminder` template defaults to channel delivery
  (throws without a channelId) AND `deliversVerbatim` (no LLM turn) — contradicting the dialog's
  own copy. The reviewer caught it by reading the SERVER's template + route tests. Rule reinforced:
  when a dialog builds a payload, check the server's blessed-payload test, not just the zod schema.
- **`watch(open)` without `immediate` is an init hole** for dialogs mounted already-open — found
  twice (test mount + cache-warm workspace list leaving a select blank). House dialogs now seed on
  `immediate: true` and read caches at open-time.
- **Computed-captured `new Date()` goes stale.** "In 15 minutes" anchored at dialog-open fires
  early/past after the user dawdles — build instants at submit-click, validate-only in computeds.
- **Global surfaces over workspace-anchored routes = aggregate + dedupe.** Knowledge/memory routes
  have no global anchor; the global sections merge every workspace's view (Promise.all, dedupe by
  id). The regression guard: the same global source seen from two workspaces yields one row.
- **Backend gaps stated honestly, not faked:** single-FILE knowledge sources (route takes a
  directory), global memory + the context/reminder/rules tagging (module-notes/memory.md's planned
  build), Discord adapter. All UI copy tells the truth about today.

## Follow-ups (also in STATE.md)

Shared dialog primitive (chrome CSS ~5×), error branches on all four sections (failed query
currently reads as "empty"), memory cursor-follow past 50/workspace, `ensureQueryData` for the
aggregates' workspaces read, backend: file-sources + global memory + memory tagging.
