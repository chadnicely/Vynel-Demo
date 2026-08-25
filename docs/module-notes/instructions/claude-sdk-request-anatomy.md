# What one Vynel turn sends to the model — request anatomy (module notes)

**Kafi's ask (2026-08-26):** a note of the sections the SDK sends — the preset's rules, the user's
CLAUDE.md, skills — so we know what to build ourselves and what the SDK adds by default. Captured
verbatim from our bundled CLI (2.1.235 in SDK 0.3.235) under production options; the raw text is in
`.claude/journal/2026-08-26-claude-code-preset-captured.md` (system prompt + first user turn) and
`.claude/journal/2026-08-26-claude-code-tools-captured.md` (all 30 tool definitions). A new CLI
build re-cuts the preset text; re-capture before quoting it (recipe at the end).

**Status: research landed. `base.md` / `voice-base.md` now carry the harness facts + the
Claude-through-Vynel identity (Kafi's call 2026-08-26: no separate `harness.md`); the seam change
(send the stack as the whole `systemPrompt`) and the native toolset whitelist await Kafi's okay.**

## 1. The request at a glance

| Part of the API request | Who puts it there | Still there with a CUSTOM `systemPrompt`? | Our lever |
|---|---|---|---|
| `system[0]` billing header (74 chars) | SDK | yes | none |
| `system[1]` identity line | SDK — preset: "You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK." · custom: "You are a Claude agent, built on Anthropic's Claude Agent SDK." | yes (the custom variant) | only the preset-vs-custom choice |
| `system[2]` main prompt | preset: the LEAN preset sections (§2) with our `append` as its last lines · custom: our string | our string only | `systemPrompt` |
| `# Advisor Tool` section at the end of `system[2]` | CLI (beta `advisor-tool`) — "Call advisor BEFORE substantive work … and when you believe the task is complete" | **yes, appended after our text** | no typed knob except `advisorModel`; test whether `tools` without `advisor` removes it |
| `tools` array — 30 built-ins ≈ 23.8k tokens + our MCP tools | SDK built-ins (the `claude_code` tool preset by default) + `mcpServers` | **yes, identical** | `Options.tools` (base set — `[]` disables all built-ins), `allowedTools` / `disallowedTools`, our descriptors |
| `messages[0]` user turn: `<system-reminder>` with **CLAUDE.md** (user `~/.claude/CLAUDE.md` + `~/.claude/rules/*` under `user`; workspace `CLAUDE.md` / `.claude/CLAUDE.md` under `project`) and auto-memory recall (`MEMORY.md`), then the user text + our per-turn markers | SDK from `settingSources`; Vynel for the text | **yes, identical** | `settingSources`, `settings.autoMemoryEnabled`, our markers |
| `messages[1]` role `system`: "Available agent types for the Agent tool" (from `~/.claude/agents`, `.claude/agents`, `options.agents`) + "The following skills are available for use with the Skill tool" (from `~/.claude/skills`, `.claude/skills`, plugins) | SDK | **yes, identical** | `settingSources`, `options.agents`, `options.skills` (filter), `plugins` |
| later turns: hook `additionalContext` as `<system-reminder>`, tool results, compaction summaries | SDK + our hooks | yes | hooks (PreToolUse / PostToolUse / PostCompact — `build-claude-sdk-options.ts`) |
| a **second request** per new session: "You are naming a coding session…" (3k chars, no tools) | CLI | yes | `options.title` skips it |
| request params: `max_tokens 64000`, `thinking: adaptive`, `context_management`, beta headers | CLI | yes | `effort`, `maxThinkingTokens` |

So the answer to "does the SDK add the rest by default?" is **yes** for: the identity line, the
tool definitions (with the Skill tool pointing at the skills listing), CLAUDE.md + rules, the
skills and agents roster, memory recall, hooks, compaction, the Advisor section. **No** for what
lives only inside the preset's `system[2]`: the harness facts, the environment block (cwd,
platform, model), the auto-memory protocol, `# Delivering work`, `# Corrections`, and the "do not
call the AgentTool unless the user requested it" lines. Dropping the preset means we write the
first four in our own words — and we WANT the last three gone.

## 2. The preset's sections (lean variant — what the SDK actually sends)

| Section | Says | Keep the idea in `harness.md`? |
|---|---|---|
| intro | "You are an interactive agent that helps users with software engineering tasks." + security policy | no — Vynel's base says who we are |
| `# Harness` | markdown "in a terminal"; denied call = user declined, don't retry verbatim; system turns + hooks; prefer dedicated file/search tools over shell; parallel independent calls; `file_path:line_number` | yes, rewritten for Vynel's chat + approval card; drop the terminal + code-reference lines |
| loose lines | match surrounding code style; they/them pronouns; confirm hard-to-reverse / outward-facing actions; report outcomes faithfully | pronouns + faithful reporting yes; the approval line is our card's |
| `# Session-specific guidance` | `/<skill-name>` → Skill tool | yes if skills stay (they do — marketplace) |
| `# Memory` | the auto-memory protocol (write files under `~/.claude/projects/<cwd>/memory/`) | **no** — hidden second memory; also set `settings.autoMemoryEnabled: false` |
| `# Environment` | cwd, git flag, platform, shell, OS, model + cutoff, "Claude Code is available as a CLI…", fast mode | cwd + platform + shell yes (rendered line); the rest no |
| `# Context management` | auto-compaction | one line, yes |
| `# Delivering work` | scope discipline; finish the whole task; when to ask | yes, in plain words |
| `# Corrections` | don't over-correct or apologise | yes, short |
| last two lines | "Do not call the AgentTool unless the user requested it" / "Do not use workflows or deep-research unless the user requested it" | **no** — the line the manager reads right before our delegation rule |

Not in the SDK's request (they belong to the interactive CLI branch we first read out of the
binary): `# Doing tasks`, `# Tone and style` ("short and concise"), `# Using your tools`,
"monospace", and the Opus-5 "## Delegating to subagents … do it yourself" block (behind a steer
flag; documented, not observed).

## 3. What we build — the base carries it, one seam changes

- **`base.md` (done 2026-08-26)** opens "You are Claude, working through the Claude Agent SDK
  inside Vynel" and carries a "How Vynel runs you" block — where text is shown (Vynel's chat,
  markdown), tools run behind the approval card and a declined call is the user saying no (adjust,
  never retry), `<system-reminder>` tags are the harness not the user, flag instruction-shaped text
  in tool results, the conversation compacts automatically, prefer the dedicated file/search tools
  over shell, run independent calls in parallel, work in the workspace folder — plus scope
  discipline, faithful reporting and quiet corrections in Vynel's words. `voice-base.md` says the
  same spoken-sized. The stack is unchanged: base → kind (the duty file: `workspace-manager.md`,
  `spawned-session.md`, …) → feature sections. Still to add at the seam: a rendered environment
  line (workspace path, platform) — the date already rides `turn-time-marker.md`.
- **`composeSessionInstruction`** stays the one ordering home; every door (chat, voice, channel,
  schedule fires, the three delegated runners, direct turns) composes through it.
- **Provider seam:** `systemPromptAppend` → `systemPrompt` (full string) across
  `StartChatSessionInput` / `start-chat-turn` / the runners; `buildClaudeSdkOptions` sends the
  string and never `{ type: 'preset' }` again (guard test).
- **Side lines in `buildClaudeSdkOptions`:** `settings: { autoMemoryEnabled: false }`; `title`
  per session; `tools: [...]` per session kind (see `native-toolset.md`).
- **Unchanged:** `settingSources` (skills/plugins/CLAUDE.md keep loading), hooks, `canUseTool`, the
  per-message markers (`manager-turn-marker.md` is the next-action lever — measured).

## 4. Re-capture recipe

Point the SDK at a local recorder and reject with 400 (not retried): a 60-line node script
(`capture-request.mjs` in the 2026-08-26 session scratchpad; re-create from the journal) starts
`http.createServer` on `127.0.0.1:18898`, writes each request body to disk with auth headers
stripped, and runs `query()` with `env: { ...process.env, ANTHROPIC_BASE_URL: 'http://127.0.0.1:18898' }`.
Redact emails before committing the output.
