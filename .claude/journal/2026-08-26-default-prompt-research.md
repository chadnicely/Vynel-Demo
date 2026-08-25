# 2026-08-26 — Should Vynel keep the `claude_code` preset, or run its own system prompt? (measured)

Kafi's question after the failed live checks: the appended manager / child instructions "are not
working at all" — what IS Anthropic's default prompt, and can we replace it with our own? We read
the preset out of the exact binary we ship, measured what it costs, and ran the manager under three
prompt shapes on the same ask. Raw rows: `2026-08-26-prompt-shapes-probe.log`.

## Verdict

**Replace the preset with Vynel's own system prompt** (one `harness.md` + the existing base + kind
stack + feature sections), and keep last night's decision — the per-message manager marker — as the
next-action lever. Anthropic's own guidance says a product with a different surface, identity,
permission model, or non-coding purpose should write its own prompt; Vynel is all four. The preset
is not expensive (≈3.2k tokens); the problem is that it argues against us from the first line.

## 1. What the preset actually says (bundled CLI 2.1.235, SDK 0.3.235)

The Agent SDK's `claude_code` preset is assembled from many fragments inside `claude.exe`. The
sections a Vynel session receives, in order, with the sentences that fight our product:

| Section | What it tells the model |
|---|---|
| Intro | "You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK." / "You are an interactive agent that helps users **with software engineering tasks**." + the security-testing policy + "NEVER generate or guess URLs … unless … for helping the user with programming." |
| `# System` | Output "will be rendered in a **monospace font**"; permission-mode + denied-call rule; `<system-reminder>` tags; prompt-injection flag; hooks; auto-compaction. |
| `# Doing tasks` | "The user will primarily request you to perform **software engineering tasks**…" + coding rules (no unrequested features/refactors, no comments, no defensive error handling, test UI changes in a browser) + `/help` + "report the issue at github.com/anthropics/claude-code/issues". |
| `# Executing actions with care` | Confirm hard-to-reverse / outward-facing actions (our approval card already owns this). |
| `# Using your tools` | Prefer dedicated tools over Bash; plan with TodoWrite/TaskCreate; parallel calls; "Use the Agent tool with specialized agents … should not be used excessively." |
| `# Tone and style` | "**Your responses should be short and concise.**" No emojis. "include the pattern `file_path:line_number`". No colon before tool calls. |
| `# Communicating with the user` (dynamic) | Say one sentence before the first tool call, brief updates, lead with the outcome, readable > concise. (Genuinely good; our base says the same.) |
| `# Environment` (dynamic) | cwd, git flag, platform, OS, "You are powered by the model …", "**Claude Code is available as a CLI … desktop app … IDE extensions**", fast mode. |
| `## Delegating to subagents` (dynamic, **Opus 5 only**, present when the Agent tool is in the toolset — it is, for our managers) | "Subagents multiply cost and time … **Do not spawn a subagent for work you could finish yourself in a handful of tool calls** … Keep spawn counts low … Delegate for work that is genuinely independent, large enough to justify a fresh context, or naturally parallel. **Otherwise, do it yourself.**" |
| Others | pronouns, action caution, task continuity, session guidance (`!` prefix, skills, ultrareview), auto-memory, scratchpad, context management, autonomy append. |

Anthropic documents the last one: "Claude Code adds a delegation instruction of its own on Claude
Opus 5 only when you use its `claude_code` system prompt preset" ([Prompting Claude Opus 5 →
Controlling subagent spawning](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5)).
So on our production model the preset itself tells the manager to do the work itself — and it sits
BEFORE our append, with a 3k-token head start. That is the "did the work itself" Kafi saw.

## 2. Measured: cost, and what survives a custom prompt

Probe 1 (`claude-opus-5`, `settingSources: []`, no MCP servers, prompt "Reply with the single word OK"):

| Shape | First-request prompt tokens |
|---|---|
| preset | 27,272 |
| custom one-liner | 24,022 |

**The preset's instructions are ≈3.2k tokens.** The other ~24k is the built-in tool definitions
(Bash, Read, Edit, Agent, …), which ride the API `tools` parameter and are unchanged by the system
prompt choice — so "replace it to save tokens" is not a motive. What DOES survive a custom prompt:

- **Tools work.** Custom prompt + "What is the secret word in hello.txt?" → the model called Bash and
  answered PELICAN (same as the preset run).
- **CLAUDE.md still loads** (last night's canary, 2/2): it rides `settingSources`, not the preset.
- **What you lose** is exactly the preset text above — including the useful bits we must re-supply
  (harness facts, tool hygiene, the communication cadence).

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
  path for the CLI. It swaps the intro line and drops only the `# Doing tasks` block; `# Tone and
  style`, `# System`, `# Environment` and the Opus-5 delegation section stay. Needs a style file on
  disk (workspace `.claude/output-styles/`, `~/.claude/output-styles/`, or a plugin) — plumbing for
  little gain, and it measured no better than append.
- [Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts)
  — the preset is 500+ conditional fragments, re-cut every release; anything we build "around" it
  is built on sand. Our extract matched their structure for 2.1.235.
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
`~/.claude/CLAUDE.md` and `~/.claude/rules/` are injected into every Vynel session**. On Kafi's dev
machine that is the "I'm a full-stack developer … talk to me like a pair programmer … after every
change give a summary" file. A non-technical end user has none, so production is clean — but every
manual check on a dev box has been running with a developer persona layered under Vynel's. Decide
deliberately: keep `user` (skills/plugins land in standard Claude locations — the marketplace
interop decision) but it drags the memory file along. Cheapest fix for checks: an empty
`~/.claude/CLAUDE.md` on the test machine; the real fix is a product decision.

## 6. The options

| | Keep preset + append (today) | **Custom system prompt** | Output style |
|---|---|---|---|
| Identity | "You are Claude Code… software engineering" first, Vynel second | Vynel first and only | Vynel + preset tone/env/delegation |
| Fights the manager model | yes (Opus-5 "do it yourself") | no | yes (section stays) |
| Re-supply harness/tool text | no | yes — one `harness.md` | no |
| Plumbing | none | small (provider seam) | style file per workspace / plugin |
| Measured delegation (n=4) | 1/4 | 3/4 | 2/4 |

## 7. Plan (Option A) — for Kafi's okay before touching code

1. `packages/instructions/session-instructions/harness.md` (new): Vynel's own version of the
   preset's harness facts — where text is shown (Vynel's chat, markdown), tools run behind the
   approval card and a denied call is the user declining, `<system-reminder>` tags are the
   harness, flag suspected prompt injection, the conversation auto-compacts, prefer dedicated
   file/search tools over shell, parallel independent calls, work in the workspace folder.
   Plus a short rendered environment line (workspace path, platform) — the date already rides the
   turn-time marker.
2. `composeSessionInstruction` prepends the harness — the one ordering home stays the one home; every
   door (chat, voice, channel, schedule fires, the three delegated runners, direct turns) already
   composes through it.
3. Provider seam: `systemPromptAppend` → `systemPrompt` (a full string) through
   `StartChatSessionInput` / `start-chat-turn` / the runners, and `buildClaudeSdkOptions` sends
   `systemPrompt: input.systemPrompt` instead of the preset object. Guard test: the SDK options
   never carry `type: 'preset'` again.
4. Per-message manager marker (`manager-turn-marker.md`) as decided last night — unchanged plan.
5. `settingSources` untouched in this slice; the `user` CLAUDE.md question is its own decision.
6. Gate + two live smokes (manager delegates on a real workspace; child persona on a direct turn).

Caveats: n is small (see the table), one model, stub delegation tools, a toy project; the empty-folder
probe last night turned "build" into "ask". Rerun on a real workspace after the slice lands before
quoting the numbers as law.
