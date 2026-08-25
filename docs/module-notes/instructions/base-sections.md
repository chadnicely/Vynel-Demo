# `base.md` — section by section (status map)

**Kafi's format (2026-08-26):** the base mirrors the preset's section order; each section is either
Anthropic's text verbatim or Vynel's patch. The prompt file itself carries NO markers (every
character reaches the model), so the "not built yet / perfect it in a separate session by verifying
the codebase" marks live here. Compare against `claude-system-prompt.md`; re-render ours with the
recipe in `.claude/journal/2026-08-26-render-system-prompts.md`.

| # | Section in `base.md` | Source | Status | To perfect in its own session — verify against the codebase |
|---|---|---|---|---|
| 1 | `# Identity` | **ours** | done | The role line assumes every door appends a kind file (it does: manager / spawned / global-root / colleague; `workspace-session.md` has no live door yet). `whoami` is on the background set for children — confirm it answers on every kind. |
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
