# `base.md` — section by section (status map)

**Kafi's format (2026-08-26):** the base mirrors the preset's section order; each section is either
Anthropic's text verbatim or Vynel's patch. The prompt file itself carries NO markers (every
character reaches the model), so the "not built yet / perfect it in a separate session by verifying
the codebase" marks live here. Compare against `claude-system-prompt.md`; re-render ours with the
recipe in `.claude/journal/2026-08-26-render-system-prompts.md`.

**Kafi's Claude-web rewrite (2026-08-26, later):** the base was reshaped again — sections now:
`# Identity` (+ role-wins line: "It refines this base; where the two differ, the role wins"; the
duty-book pointer moved here) · security (verbatim) · `# Harness` (+ "check the environment with
your tools, don't assume"; "other sessions only through Vynel's session tools — never spawn agents,
timers, or background processes of your own", which the role-wins line lets `spawned-session.md`
override for the FRESH review agent) · `# Continuity` (four places: Memory — what holds · Journal —
what happened · Knowledge base — what you'd look up · Notebook — how we work; absorbed `# Code`) ·
`# Context management` (a session is a persona, not a context window; the alert path ends in the
`checkpoint` call — patched to match the swap machinery) · `# Session-specific guidance` (verbatim)
· `# Working with the user` (one-question-at-a-time, options with a recommendation, uncertainty
mid-task, refusal shape, other-sessions-can-be-wrong) · `# Pronouns` · `# Output format` (absorbed
`# Working out loud` — the UI-load-bearing step-line rules live here now). Fixed during review:
`create_knowledge_entry` → `add_to_knowledge` (the real tool); three test pins moved to the new
wording. Caveat to verify: the knowledge tools are capability-gated per workspace — the base
promises them everywhere; check the denied-call experience where knowledge is off.

| # | Section in `base.md` | Source | Status | To perfect in its own session — verify against the codebase |
|---|---|---|---|---|
| 1 | `# Identity` | **ours** | done | Carries two of Kafi's rules: continuity is part of the identity (facts → memory, happenings → journal, automatically, as the day-by-day timeline it reads back), and "if these instructions differ from the ones you were following earlier, pause and follow these first" (a long conversation's old habits must not outrank the current base). The role line assumes every door appends a kind file (it does: manager / spawned / global-root / colleague; `workspace-session.md` has no live door yet). `whoami` is on the background set for children — confirm it answers on every kind. |
| 2 | security paragraph (headingless, as in the preset) | **Anthropic verbatim** | done | Re-diff against the capture after each CLI bump. |
| 3 | `# Harness` | **ours** | done, verify | Approval-card semantics per mode (`ask` cards the destructive tier; `auto` never cards) — the line "a declined call means the user said no" must match `canUseTool`'s denial text. `<system-reminder>` sources: hooks' `additionalContext`, CLAUDE.md, memory recall. Add the environment line (workspace path, platform) once the seam renders it. |
| 4 | `# Code` | **ours → notebook** | **not built yet** | The Coding Guideline book does not exist in the notebook. Write it (Kafi), publish it, then tighten the line to "read it before coding" and drop the fallback. Check `list_playbooks` exposes it to every kind that writes code (manager, child, colleague). |
| 5 | pronoun paragraph (headingless) | **Anthropic verbatim** | done | — |
| 6 | `# Session-specific guidance` | **Anthropic verbatim** | done, verify | "the user-invocable skills section" is the SDK's roster in `messages[1]` — confirm marketplace-installed skills appear there under our `settingSources`. Vynel-specific guidance (skills via `list_available_skills` / `install_marketplace_item`) may join later. |
| 7 | `# Memory` | **ours (patch)** | **partly built** | Today: Vynel memory = DB entries + the standing snapshot (`buildMemorySessionContribution`, capability "memory") + the tools named. Planned: the project's `.claude/memory.md` in Vynel's format, added as a memory SOURCE (`add_memory_from_file`) so it is read through the memory tool, never by opening the file. Dedupe with `MEMORY_AGENT_INSTRUCTIONS` (the same rule is stated twice on workspace turns). The SDK's own auto-memory is OFF (`autoMemoryEnabled: false`). |
| 8 | `# Context management` | **ours (patch)** | done, verify | Journal = the durable history (`add_journal_entry` / `list_journal_entries`; `commit` ref). The "rule book" = the duty book per kind — none published yet (`duty-global-root` named in `global-root.md`); until then `whoami` reports unpublished. Confirm compaction keeps the journal pointer (checkpoint carry). |
| 9 | `# Working with the user` | **ours** | done | Carries the pinned disciplines (plain language, ask-don't-invent, approval card, real schedules) + Delivering-work / faithful reporting / quiet corrections from the preset, in Vynel's words. |
| 10 | `# Working out loud` | **ours** | done, UI-load-bearing | `ONE short line` / `no text between them` are pinned — `ToolCallList` folds batches behind the step line. Never reword without the UI. |
| 11 | `# Replies` | **ours** | done | — |

Not carried from the preset, on purpose: `# Environment` (date rides `turn-time-marker.md`; path +
platform to be rendered at the seam), the SDK memory protocol, "Claude Code is available as…",
`file_path:line_number`, the "Do not call the AgentTool unless the user requested it" lines.

`voice-base.md` mirrors sections 1, 2, 3 (spoken-sized), 7, 8 and 9; the alignment test pins the
shared core to both files — keep them in step.

## Kind files — what the base now covers, removed from each

| Kind file | Removed (base covers it) | Kept (kind-specific) | Status |
|---|---|---|---|
| `global-root.md` | the schedule rule text (only the `create_my_schedule` name mapping stays), the duty-book id line (`whoami` → `read_playbook`), ask-don't-invent (only "ask which workspace" stays), the identity wording ("You are Vynel's…" → the role) | the role above all workspaces, the five routing/channel tools + the Display bullet, the 3-step routing recipe, "route all project work — do not read files or do a project's work yourself, even where a tool would let you" (true by structure once the global root gets `tools: []`) | trimmed 2026-08-26 (3107 → 2499 chars) |
| `workspace-manager.md` | "in plain words" (base owns the reply style) | the manager role; now NAMES the delegation tools — `create_session` + `send_message` (kind "task") with clear instructions; tasks visible on the list; worktrees; the merge is the manager's, never another child's | polished 2026-08-26 |
| `spawned-session.md` | the journal clause (base: the journal is written as it happens) | child duty: context first, own worktree, test-first, the FRESH review agent, report through the routed instructions ("chat text alone reaches no one") | polished 2026-08-26 |
| `agent-colleague.md` | — | reconciled with the base's `# Memory`: "This conversation is your memory of the work … and the standing facts about the user live in Vynel's memory, like every session's" | polished 2026-08-26 |
| `workspace-session.md` | — | unchanged — already minimal | ok (no live door yet) |

Same pass, in code: the `## Task list` feature section
(`apps/mcp/src/vynel-mcp-feature-descriptor.ts`) no longer says "you drain it… one task
in-progress at a time; set it in-progress when you start" — it now reads delegation-aware ("each
task is worked by one session — quick work by you, anything substantial by the child you hand it
to") so the standing feature text stops arguing with the manager model on every turn.
