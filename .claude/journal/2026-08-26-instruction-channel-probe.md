# 2026-08-26 — Which instruction channel actually steers the manager? (measured)

Kafi's hypothesis after the failed live check: the manager instruction "is not landing or is not
prioritized." We measured instead of arguing. Raw log: `2026-08-26-instruction-channel-probe.log`.

## Setup

A temp probe (`packages/instructions/src/_probe-instruction-channels.ts`, deleted after) ran
`query()` on the production model (`claude-opus-5`), fresh session per run, bypass permissions,
`settingSources: ['user','project','local']` (production shape), an in-process `vynel` MCP server
with stub `delegate_to_child` / `create_task` / `update_task` tools, natives on unless noted, 12-turn
budget, 2 runs per variant. Same ask every time: *"Add an email feature… welcome email on signup.
Please build it."* Same conflict every time: the REAL `base + workspace-manager` stack vs the REAL
`## Task list` "you drain it" section. Measured: did the model call `delegate_to_child`?

## Results (round 2)

| Variant | Delegated |
|---|---|
| A0 identity in `append`, NO competing section | 0/2 |
| A production shape (identity + competing in `append`) | 0/2 |
| C production + identity again via `UserPromptSubmit` → `additionalContext` (per turn) | 0/2 |
| **D2 production + ONE-LINE manager marker on the user message** | **2/2** |
| T production, manager with NO Write/Edit/Bash | 0/2 |
| K canary: `CLAUDE.md` secret word, preset + append | PINEAPPLE 2/2 |
| K canary: `CLAUDE.md` secret word, CUSTOM string system prompt | PINEAPPLE 2/2 |

Round 1 (4-turn budget, whole manager text on the user message) agreed: the user-message channel was
the only one that ever delegated (1/2, at the 8th call); everything system-prompt-side was 0/2.

## Learnings

1. **The user-turn channel is the one that drives the next action.** Every system-prompt-side
   channel — `append` (either order), the per-turn `UserPromptSubmit` hook, `SessionStart`
   context, a `.claude/rules` file, a custom system prompt — left the manager exploring and then
   ASKING (the temp folder was empty, so "ask, don't invent" won) — but never delegating. One line
   on the user message flipped it every time, and the flow it produced was Kafi's: explore →
   `create_task` → `delegate_to_child` → `update_task`, with the empty folder flagged in the reply.
   This is the voice-turn-marker lesson again, now measured: standing prompts set identity; the
   per-message marker sets the NEXT ACTION.
2. **Removing the build tools does NOT produce delegation by itself** (T: 0/2 — it explored with
   Glob/Read and asked). Toolset shaping is hygiene, not the lever.
3. **The contradiction was not the root cause** (A0 without the competing section: 0/2). Still
   worth removing for coherence, but it is not what stops delegation.
4. **CORRECTION: a custom string system prompt does NOT lose CLAUDE.md** on this SDK (0.3.235) —
   the canary answered from `CLAUDE.md` under both shapes. What a custom prompt loses is Claude
   Code's own operating prompt. (My earlier read of the `excludeDynamicSections` docs was wrong.)
5. Caveats: n=2 per variant, one model, an EMPTY folder (which turned "self-work" into "ask" —
   in the real letterman workspace the same runs would likely self-build), stub tools.

## What this decides

- Build the **per-message manager marker** (`manager-turn-marker.md`, appended to every manager
  turn's provider input — `start-chat-turn.ts` / the delegated runners), naming
  `create_session` + `send_message` as the delegation tools. Same for the child's duties and for
  the "a child reported DONE → verify, merge, remove worktree, close task" step — as per-message
  markers on the delivered message, not as system-prompt steers.
- Keep the prompt-side cleanup (contradiction, tool names, headings) as reinforcement.
- The `InstructionsLoaded` hook never fired under the SDK — not a usable verification channel.