# Five-task session report — 2026-08-02

All five tasks are **shipped, reviewed, gated, committed, and pushed**. Every commit landed on
a green full gate (`pnpm test` = typecheck + parity + vitest). Final gate on the finished
tree: **3,771 passed / 665 files** (session started at 3,488 — ~283 new tests). Each task got
a code-reviewer pass; every MUST/SHOULD-FIX was applied before its commit. Playwright smokes
ran against the live dev stack after each UI task.

| Task | Commit | Review | Gate | Smoke |
|---|---|---|---|---|
| 1 · Admin catalog: GitHub/zip publish, credits, pickers | `1dff848` | 1 must-fix + 2 should-fix, all fixed | 3,548 ✅ | Portal login, form, real GitHub Inspect ✅ |
| 4 · Global menus show only global items | `85dc504` | CLEAN | 3,563 ✅ | Global Tasks/Memory scoped ✅ |
| 2 · Rules/Commands/Skills/MCP menus + custom MCP | `89c868a` | CLEAN (1 comment fix) | 3,637 ✅ | Menus render real data; add-dialog ✅ |
| 3 · @ mentions, / picker, # workspace refs | `49abdfd` | 3 should-fix, all fixed | 3,733 ✅ | All three pickers pop with real data ✅ |
| 5 · Session todo dock + set_todos | `5b068ee` | CLEAN (1 test-gap fix) | 3,771 ✅ | Route + migration + clean load ✅ |

Also: the leftover env path-resolution fix from last session was already committed pre-session
(`430fb17`); the baseline gate proved the tree green before any work began.

## What each task shipped

**Task 1 — publish from GitHub + credits + pickers (cloud).** Portal publish page has an
"Upload zip / From GitHub URL" mode toggle; Inspect prefills the form from the repo (full
prefill when the folder carries `vynel-item.json`, kind detection otherwise). Hub-side: one
hardened git home (https + github.com only, ref resolved to a pinned sha, `protocol.ext`
blocked), kind-aware packing for all five kinds, and publish-time zip inspection on BOTH
publish paths (traversal/symlink/bomb walls; symlinked repo folders refused at pack — the
reviewer-caught arbitrary-file-read that only manifests on a Linux deploy). Credits are real:
publisher picker (existing publishers sent verbatim so publishes can't silently re-tier them,
"+ new publisher" incl. anthropic-official) + sourceUrl. Icon picker over a curated 48-icon
contracts-homed set both portal and app render; categories are open — admin-defined, rendered
verbatim in the app (the silent "context" coercion is gone). Fixed live bug: version bumps no
longer wipe sourceUrl / reset the publisher.

**Task 4 — Global scoping.** Global = `workspaceId IS NULL` everywhere: six sections
(plans/schedules/tasks/journal/ssh/notebook) + the tasks side-panel; knowledge and memory got
real user-scoped global routes replacing client-side fan-outs. Workspace fusion (workspace +
global items) unchanged and now honored by the tasks panel too.

**Task 2 — config-surface menus + custom MCP.** Rules (your hand-written files listed, with
provenance chips on marketplace ones), Commands (greenfield reader over `.claude/commands`),
MCP Servers (full-config list, scope/transport chips), Skills promoted to a real section on
Global too. Add-custom-MCP: stdio or remote http/sse at either scope, header auth, masked
wire (header values never leave the config file again — names + hasValue only), collision
409, https-only remote with exact-loopback exemption. Underneath: the load-bearing writer fix
— remote MCP entries were being written in a shape Claude Code executed as a stdio command;
the writer now emits real `{type,url,headers}` shapes, readers tolerate legacy/foreign
entries, and the contract is a transport-discriminated union that still parses every
published manifest.

**Task 3 — @ / # / / in every chat.** One grammar home in contracts (offsets, quoted
`#"…"` form, round-trip-guarded pickers). All three pickers pop on the bare trigger at the
caret, filter as you type, keyboard + click, IME-safe (also fixed the pre-existing
send-mid-composition bug). @agent runs the message as a deterministic background leaf (new
`agent-run` job kind, exempt from the workspace single-writer slot, co-committed completion)
with the report delivered to the ORIGINATING chat via a server-stamped requester header;
@persona routes to that workspace's manager. # grants the turn read-only study tools
(overview / file tree / file read, path-guarded + size-capped) for exactly the referenced
workspaces. / inserts commands verbatim and skills as explicit instructions. Zero wire
changes — the server re-parses message text as the only routing truth.

**Task 5 — session todo dock.** Todos = the steps of current work (distinct from tasks, per
your call). `session_todos` lives in the tasks leaf (generated migration 0028); one
non-carding `set_todos` whole-list-replace tool on every surface, session identity
server-stamped via a lazy per-turn carrier resolved from the turn's own events (spoofed ids
ignored, tenant-checked). Dock renders above the chat input in all three hosts, ticks live
mid-turn, folds past five steps, user check-off + remove, hides when empty. Also fixed the
pre-existing bug where Claude's mid-turn task changes never refreshed the side panel.

## Decisions you made that shaped the build

All recorded in `.claude/plan/five-task-session.md`: repo import = all five kinds ·
categories admin-defined + global · MCP auth = headers in config · custom MCP at both scopes
with a gitignore teaching note · @agent = background run + report · # = awareness + read
access to study the workspace · pickers pop on the bare trigger · todos are durable,
session-scoped, and NOT tasks · leftover env fix committed first · shutdown confirmed.

## ⚠ Decisions waiting on you

1. **Global memory ceiling.** `memory_entries.workspace_id` is NOT NULL — global memory rows
   cannot exist yet. The read path is built and honest (empty state); lifting it = a
   deliberate move: nullable-column migration + `MemoryEntrySchema.workspaceId.nullable()` +
   a global create path.
2. **`McpToolFn` fifth copy** (Task 3 module notes) — two conflicting recorded stances on
   promoting it to a shared home; your fork.
3. **Background turns and todos** — schedule/delegation turns are prompted for step-tracking
   but their `set_todos` 400s gracefully until the session header threads through the
   delegation ticks (recorded in `docs/module-notes/session-todos.md`).

## Your smoke list (what only a real turn can prove)

- Chat "@" an agent → watch the background run land its report box back in the same chat.
- "#" a workspace and ask something about it → Claude should study it with the read tools.
- A multi-step ask anywhere → the todo dock should fill and tick live under the chat.
- Portal → publish a real item From GitHub URL end-to-end (Inspect smoked ✅; a full publish
  writes to the hub, so it was left to you).
- Add a custom remote MCP with a header → new session sees the server.

## Known non-blockers

- `apps/voice/src/overlay/overlay-channel.test.ts` flaked once under full parallel load
  ("bad port"), passes isolated and on re-runs — pre-existing, untouched by this session,
  worth pinning down someday.
- Prettier reports pre-existing repo-wide drift on some backend files (`format:check` is not
  in the gate); untouched.
- Deferred-improve lists per task live in each `docs/module-notes/` file
  (admin-repo-publish · config-surfaces-views · chat-mentions · session-todos).
