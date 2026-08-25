# Native toolset — which of Claude Code's built-in tools Vynel keeps (module notes)

**Kafi's call (2026-08-26):** keep Claude Code's BASE tools and attach ours; drop what Vynel can't
use ("Workflow does nothing for us — Vynel can't use workflows, we play with sessions"). Polish
per session kind later.

**Status: the foundation is live** — `CLAUDE_CODE_BASE_TOOL_NAMES` in
`packages/providers/src/claude/base/build-claude-sdk-options.ts`, sent as the SDK's `Options.tools`
whitelist on every session (pinned by its test). Vynel's own tools ride `mcpServers` with their own
descriptions, as before. The tool definitions themselves are captured verbatim in
`.claude/journal/2026-08-26-claude-code-tools-captured.md`.

## The lever

`Options.tools` is the base set of BUILT-IN tools (`string[]`; `[]` disables every built-in; the
`claude_code` preset = all 30). It is independent of the system prompt — a custom prompt changes
nothing here — and of `allowedTools` / `disallowedTools`, which filter within the base set. Each
built-in carries its own description in the API `tools` array; MCP tools bring theirs. So "tool
guidance" is never patched with prompt text: pick the set, and write good descriptions on our
descriptors.

## Kept (≈4.4k tokens of definitions)

| Tool | Why it stays |
|---|---|
| `Bash`, `Read`, `Edit`, `Write`, `Glob`, `Grep` | the project work itself |
| `WebFetch`, `WebSearch` | research and reading the web |
| `Agent` | a child's FRESH review agent (`spawned-session.md`); parallel exploration |
| `Skill` | marketplace skills install into the standard Claude locations and are invoked through it |
| `TaskOutput`, `TaskStop` | ride with Bash so a background shell run is never a dead end |

`AskUserQuestion` stays in `disallowedTools` (no Vynel answer channel; `ask_user` is ours).

## Dropped (≈19k tokens of definitions per request, before this change)

| Tool | Why it goes | Vynel's equivalent |
|---|---|---|
| `Workflow` (19k chars) | multi-agent orchestration scripts — Claude Code's, not ours | sessions: `create_session`, `send_message`, `send_task_to_session` |
| `CronCreate` / `CronDelete` / `CronList`, `ScheduleWakeup` | in-session timers and loops | `create_schedule` / `create_my_schedule` + the scheduler |
| `Monitor` | background event watch | monitors + background processes (`create_monitor`, `run_background_process`) |
| `SendMessage`, `ListAgents` | Claude Code agent teams | `send_message`, `list_sessions`, colleagues |
| `PushNotification`, `RemoteTrigger`, `DesignSync`, `ReportFindings` | claude.ai / cloud / design / code-review surfaces | channels, the Display, the journal |
| `EnterWorktree` / `ExitWorktree` | the manager owns worktrees; a child never merges or removes one | github-connection Slice 4 (worktree state tools) — revisit for children |
| `LSP`, `NotebookEdit` | code-intelligence and Jupyter | none needed for now |

## Polish later (per session kind)

- **Global brain**: its prompt says it has no file tools — give it `tools: []` (routing + notebook +
  session + desktop MCP only) so the prompt is true.
- **Voice thread**: probably `[]` as well; it speaks and routes.
- **Children / colleagues**: consider `EnterWorktree` once the worktree flow is settled; the manager
  never gets `ExitWorktree`.
- **Manager**: decide whether `Agent` stays (quick parallel exploration) or every hand-off goes
  through a Vynel child session.
- The `advisor` server-side tool (beta) is added by the CLI itself; check whether a whitelist without
  it removes the `# Advisor Tool` section.
