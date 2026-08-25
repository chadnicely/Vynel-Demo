# 2026-08-26 — Should Vynel keep the `claude_code` preset, or run its own system prompt? (measured)

Kafi's question after the failed live checks: the appended manager / child instructions "are not
working at all" — what IS Anthropic's default prompt, and can we replace it with our own? We
captured the exact request the bundled CLI sends, measured what the preset costs, and ran the
manager under three prompt shapes on the same ask.

Companion files: `2026-08-26-claude-code-preset-captured.md` (the system prompt verbatim, both
shapes, plus the first user turn) · `2026-08-26-claude-code-tools-captured.md` (all 30 tool
definitions verbatim) · `2026-08-26-prompt-shapes-probe.log` (raw probe rows).

## Verdict

**Replace the preset with Vynel's own system prompt** (one `harness.md` + the existing base + kind
stack + feature sections), keep last night's decision — the per-message manager marker — as the
next-action lever, and take two side findings as their own slices: **switch the SDK's hidden
auto-memory off** and **trim the native tool set**. Anthropic's own guidance says a product with a
different surface, identity, permission model, or non-coding purpose should write its own prompt;
Vynel is all four. The preset is not expensive (≈3.2k tokens); the problem is what it says.

## 1. What the SDK actually sends (captured, CLI 2.1.235 inside SDK 0.3.235)

Captured by pointing `ANTHROPIC_BASE_URL` at a local recorder under our production options
(`claude-opus-5`, `settingSources: ['user','project','local']`, one stub MCP tool). The request has
three `system` blocks, a `tools` array, and the first user turn:

| Part | preset + append (today) | custom string |
|---|---|---|
| `system[1]` identity | "You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK." | "You are a Claude agent, built on Anthropic's Claude Agent SDK." |
| `system[2]` main prompt | 11,422 chars ≈ 3.2k tokens (below) — **our append is its last lines** | our string + the CLI's `# Advisor Tool` section |
| `tools` | 30 definitions, ≈23.8k tokens — **identical** | identical |
| `messages[0]` | user turn + `<system-reminder>` blocks (CLAUDE.md, memory) — identical | identical |
| `messages[1]` (role system) | "Available agent types for the Agent tool" — 10k chars from the dev box's `~/.claude/agents` + the repo's | identical |

**The SDK gets the LEAN preset**, not the long CLI prompt I first read out of the binary (that
branch — `# Doing tasks`, `# Tone and style` "short and concise", `# Using your tools`,
"monospace" — did NOT appear in the captured request). What it does say, in order:

| Section | What it tells the model |
|---|---|
| Intro | "You are an interactive agent that helps users **with software engineering tasks**." + the security-testing policy. |
| `# Harness` | Text is "displayed to the user as Github-flavored markdown **in a terminal**"; permission mode + denied-call rule; mid-conversation system turns; hooks; prefer dedicated file/search tools over shell; parallel calls; "Reference code as `file_path:line_number`". |
| loose lines | Match surrounding code style; they/them pronouns; confirm hard-to-reverse / outward-facing actions; report outcomes faithfully. |
| `# Session-specific guidance` | `/<skill-name>` → Skill tool. |
| `# Memory` | "You have a persistent file-based memory at `~/.claude/projects/<cwd>/memory/`… write to it directly with the Write tool" + the whole memory-file protocol. |
| `# Environment` | cwd, git flag, platform, shell, OS, "You are powered by the model named Opus 5", cutoff, model ids, "**Claude Code is available as a CLI … desktop app … IDE extensions**", fast mode. |
| `# Context management` | auto-compaction. |
| `# Delivering work` | Scope discipline, finish the whole task, when to ask. (Good; keep the idea.) |
| `# Corrections` | Don't over-correct or apologise. (Good.) |
| **last two lines before our append** | "**Do not call the AgentTool unless the user requested it**" / "Do not use workflows or deep-research unless the user requested it". |
| after our append | `# Advisor Tool` — a server-side `advisor` tool "backed by a stronger reviewer model"; "Call advisor BEFORE substantive work … and when you believe the task is complete." Added to the custom shape too. |

So the words the manager reads immediately before "anything substantial goes to a child session"
are *don't hand work to another agent unless the user asked*. The Opus-5 "## Delegating to
subagents … Otherwise, do it yourself" block exists in the binary and is documented by Anthropic
([Prompting Claude Opus 5 → Controlling subagent spawning](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5)),
but it is behind a remote/model steer flag and was NOT in this first request — don't quote it as
present.

### Three side findings from the capture

1. **Hidden second memory.** The preset's `# Memory` section is live in Vynel sessions: this
   machine has 68 `~/.claude/projects/*/memory/` dirs, and the Vynel global root's hidden SDK cwd
   (`C--Users-KLONE--vynel-global-root/memory`) holds `MEMORY.md` + `desktop-control-focus-quirks.md`
   — memories the user never sees, beside `@vynel/memory`. The SDK `Settings` type has
   `autoMemoryEnabled: false` ("will not read from or write to the auto-memory directory") — one
   line in `buildClaudeSdkOptions`' `settings`.
2. **Tool guidance lives in the `tools` array, not the prompt.** Every one of the 30 native tool
   definitions is sent whatever the system prompt says — `Workflow` (19k chars), `Monitor` (6k),
   `DesignSync`, `ScheduleWakeup` + `CronCreate` (compete with Vynel schedules), `RemoteTrigger`,
   `SendMessage` / `ListAgents`, `PushNotification`, `EnterWorktree` / `ExitWorktree`, `Skill`,
   `LSP`, `ReportFindings`, `TaskOutput` / `TaskStop`, `NotebookEdit`. The only levers are
   `disallowedTools` / `allowedTools` and our own MCP descriptions. Denying the ones a
   non-technical product never wants also shrinks every request.
3. **A second request per new session** names the session ("You are naming a coding session…",
   3k chars). Passing `options.title` skips it.

## 2. Measured: cost, and what survives a custom prompt

Probe 1 (`claude-opus-5`, `settingSources: []`, no MCP servers, prompt "Reply with the single word OK"):

| Shape | First-request prompt tokens |
|---|---|
| preset | 27,272 |
| custom one-liner | 24,022 |

**The preset's instructions are ≈3.2k tokens.** The other ~24k is the tool definitions above,
unchanged by the system prompt choice — so "replace it to save tokens" is not a motive. What DOES
survive a custom prompt:

- **Tools work.** Custom prompt + "What is the secret word in hello.txt?" → the model called Bash and
  answered PELICAN (same as the preset run).
- **CLAUDE.md still loads** (last night's canary, 2/2): it rides `settingSources`, not the preset.
- **What you lose** is exactly the preset text above — including the parts worth re-supplying
  (harness facts, tool hygiene, `# Delivering work`, `# Corrections`).

## 3. Measured: does the prompt shape change the manager's behaviour?

Probe 2: the real `base.md + workspace-manager.md` stack, the real `## Task list` section, a small
REAL project (express `/signup` route + users module), stub `create_task / update_task / list_tasks /
delegate_to_child` MCP tools, `claude-opus-5`, fresh session per run, 12-turn budget, ask =
*"Add an email feature to this project: when a user signs up, send them a welcome email. Please
build it."* Measured: did it hand the work to a child, or build it itself?

| Shape | Delegated | Self-built the feature |
|---|---|---|
| `claude_code` preset + `append` (production today) | **1/4** | **3/4** — wrote `src/email.js` (+ `src/emails/welcome.js`), ran the app, signed up test users: "Done — the welcome email is built and working" |
| **Custom system prompt** (harness + stack + task list, no preset) | **3/4** | 1/4 — run 4 was cut at the 12-turn budget with `src/email.js` already written |
| Preset + Vynel output style (`settings.outputStyle`, style file in `.claude/output-styles/`) | 2/4 | 2/4 — `src/email/mailer.js`, `welcome-email.js`, `logger.js`, `.env.example` |

Two rounds of two. Every delegating run took the same road — explore (2–4 Bash/ToolSearch calls) →
`create_task` → `update_task` → `delegate_to_child` → a plain-words reply — in 54–80 s; every
self-build ran 10+ Bash calls and 77–141 s (custom-3 even `git init`-ed and committed the project
before delegating: a manager preparing main for the child's worktree). All three run-4s hit the
12-turn budget; the SDK surfaces that as an error result (`Reached maximum number of turns`), so
those rows carry no tool list and the self-build verdict comes from the files they left behind.
n=4 per shape: read as a strong lean, not a law.

Read together with last night's probe (empty folder: every system-prompt channel 0/2, a one-line
marker on the user turn 2/2): the custom prompt fixes the **identity** contest; the per-message
marker fixes the **next action**. Both are needed; neither replaces the other.

## 4. What Anthropic and others say

- [Modifying system prompts](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts):
  "The deciding factor is how closely your agent resembles Claude Code … The further your product
  is from that, the more you'll want to write your own prompt." Custom prompt for a **different
  surface** (a chat UI, not a terminal), **different identity** (shouldn't present itself as Claude
  Code), **different permission model** (our approval card), **non-coding tasks** ("most of Claude
  Code's prompt is coding guidance … that guidance competes with the instructions you actually
  need"). Custom = "You take responsibility for replacing the tool guidance and safety instructions
  your agent still needs."
- [Output styles](https://code.claude.com/docs/en/output-styles): the sanctioned "different role"
  path for the CLI. It swaps the intro line and drops the coding block; the harness, environment
  and memory sections stay. Needs a style file on disk (workspace `.claude/output-styles/`,
  `~/.claude/output-styles/`, or a plugin) — plumbing for little gain, and it measured no better
  than append.
- [Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts)
  — the preset is 500+ conditional fragments, re-cut every release; anything we build "around" it
  is built on sand (this capture is already a snapshot of one build).
- [Team 400](https://team400.ai/blog/2026-04-claude-agent-sdk-system-prompts-customisation) and the
  [SDK-vs-CLI report](https://github.com/shanraisshan/claude-code-best-practice/blob/main/reports/claude-agent-sdk-vs-cli-system-prompts.md):
  coding products should keep the preset (+ `settingSources`), because "agents produce noticeably
  worse code on the minimal prompt". Right for coding agents; the reason to keep it is the coding
  guidance we do not want.
- [BSWEN](https://docs.bswen.com/blog/2026-03-15-claudemd-vs-system-prompt-priority/): appended
  directives lose to the preset by **structural position**, not token count — matches what we
  measured. Their workaround (add the WHY to each rule) is worth keeping in our files.
- [Prompting Claude Fable 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5):
  "Skills developed for prior models are often too prescriptive … consider removing older
  instructions if default performance is better" — the same lesson: fewer, truer instructions.

## 5. A confound in every live check so far

`buildClaudeSdkOptions` sets `settingSources: ['user', 'project', 'local']`, so the **end user's
`~/.claude/CLAUDE.md`, `~/.claude/rules/` and `~/.claude/agents/` are injected into every Vynel
session**. On Kafi's dev machine that is the "I'm a full-stack developer … talk to me like a pair
programmer" file plus a 10k-char agent roster. A non-technical end user has none, so production is
clean — but every manual check on a dev box has been running with a developer persona layered
under Vynel's. Keep `user` (skills/plugins land in standard Claude locations — the marketplace
interop decision) knowing it drags these along; cheapest fix for checks: an empty
`~/.claude/CLAUDE.md` on the test machine.

## 6. The options

| | Keep preset + append (today) | **Custom system prompt** | Output style |
|---|---|---|---|
| Identity | "You are Claude Code… software engineering" first, Vynel second | Vynel first and only | Vynel + preset harness/env/memory |
| "Don't call the AgentTool unless asked" right before our rules | yes | no | yes |
| Hidden auto-memory section | yes (fix separately) | no | yes |
| Re-supply harness/tool text | no | yes — one `harness.md` | no |
| Plumbing | none | small (provider seam) | style file per workspace / plugin |
| Measured delegation (n=4) | 1/4 | 3/4 | 2/4 |

## 7. Plan (Option A) — for Kafi's okay before touching code

1. `packages/instructions/session-instructions/harness.md` (new): Vynel's own version of the
   preset's harness facts — where text is shown (Vynel's chat, markdown), tools run behind the
   approval card and a denied call is the user declining, `<system-reminder>` tags are the
   harness, flag suspected prompt injection, the conversation auto-compacts, prefer dedicated
   file/search tools over shell, parallel independent calls, work in the workspace folder — plus
   the `# Delivering work` / `# Corrections` ideas in Vynel's words. A short rendered environment
   line (workspace path, platform); the date already rides the turn-time marker.
2. `composeSessionInstruction` prepends the harness — the one ordering home stays the one home; every
   door (chat, voice, channel, schedule fires, the three delegated runners, direct turns) already
   composes through it.
3. Provider seam: `systemPromptAppend` → `systemPrompt` (a full string) through
   `StartChatSessionInput` / `start-chat-turn` / the runners, and `buildClaudeSdkOptions` sends
   `systemPrompt: input.systemPrompt` instead of the preset object. Guard test: the SDK options
   never carry `type: 'preset'` again.
4. Per-message manager marker (`manager-turn-marker.md`) as decided last night — unchanged plan.
5. Side slices (independent, each one line in `buildClaudeSdkOptions`): `settings: { autoMemoryEnabled:
   false }`; `title` per session (skips the naming request); a `disallowedTools` list for the native
   tools Vynel never wants (decide the list against the tools file).
6. `settingSources` untouched; the `user` CLAUDE.md question is its own decision.
7. Gate + two live smokes (manager delegates on a real workspace; child persona on a direct turn).

Caveats: n is small (see the table), one model, stub delegation tools, a toy project; the empty-folder
probe last night turned "build" into "ask"; the capture is one CLI build. Rerun on a real workspace
after the slice lands before quoting the numbers as law.
