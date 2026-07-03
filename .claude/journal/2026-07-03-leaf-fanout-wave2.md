# 2026-07-03 — leaf fan-out wave 2 (mcp-contract · desktop-control · contracts · agents)

Second parallel fan-out, run in a ~20-min window. Four more packages across **two bundled worktree agents**
(each bundle = a dependency + its consumer, so the worktree is self-contained and agents don't collide on a
shared package). Committed as `ae985bb`. Suite **900 → 1019** (+119).

**Agent A — `mcp-contract` (2 files) + `desktop-control` (31 files).** `mcp-contract` = the
`McpFeatureDescriptor` contract (type-only; its `createSdkMcpServer` ref is the permitted SDK *builder*
export, not the runtime `query`). `desktop-control` = desktop MCP tools (a11y read + gated act); review
confirmed the gating is faithful — `mutatingToolNames`, `enableDesktopActions ?? false` (default-off),
`destructiveHint: true`. New external deps `@crowecawcaw/xa11y` + `zod`.

**Agent B — `contracts` (36 files) + `agents` (19 files).** `contracts` = shared Zod schemas by domain
(`agents/`, `chat/`, `schedules/`, `marketplace/`, `onboarding/`, `skills/`, …), kernel-level (deps `zod`
only), pulled whole + faithful — its wildcard `exports` (`"./*": "./src/*.ts"`) preserved verbatim, which is
what lets `agents` resolve deep subpaths like `@vynel/contracts/agents/curated-agents/...`. **This unblocks
`skills`/`channels`/`schedules`/`marketplace` for future waves.** `agents`'s only SDK ref is a type-only
`import type { AgentDefinition }` — AI-seam intact (a deferred-improve: agents could own that type to shed the
SDK dep). Both reviews **PASS, 0 findings**, faithfulness diff-verified vs source.

**GOTCHA — worktree isolation can silently not take.** Agent A's `isolation: "worktree"` did NOT create a
separate worktree (its completion notification had no `<worktree>` block, unlike every other agent). So it ran
in the **main working tree** and left main's HEAD on its `pull/desktop-stack` branch (the `code-reviewer` even
noted "main working tree currently on pull/desktop-stack"). `main` the branch *ref* stayed safe at `cf46be4`.
Recovery: `git checkout -f main` (discards the misplaced checkout; all work safe on the `pull/*` branches),
then integrate all four via `git checkout pull/<stack> -- packages/<pkg>` from a clean `main` → one commit.
**Lesson:** after a worktree fan-out, verify `git rev-parse --abbrev-ref HEAD == main` before integrating; an
agent whose isolation didn't take will have moved HEAD.

**Gate green:** typecheck (26 pkgs) + parity (30 / 7 / 7·8, unchanged) + vitest **1019 pass / 4 skip**.

**Two waves today = 8 packages pulled** (capabilities/files/memory/approvals + mcp-contract/desktop-control/
contracts/agents), all faithful + code-reviewed + green. Deferred as before: the **vertical-slice**
(schema→package) + **routes** for all of them; `session` (composition, single-session); the improve-pass items
(agents' SDK type-dep, `xa11y-adapter.ts` 305 lines).
