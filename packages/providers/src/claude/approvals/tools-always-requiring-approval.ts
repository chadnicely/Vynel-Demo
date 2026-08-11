// The single source of truth for tools whose effects are irreversible
// enough to require an approval card outside an explicit user grant.
//
// Consumed by BOTH:
//   - `build-claude-can-use-tool-callback` — the behavior gate that cards
//     these under `bypass-with-behavior-gate` (the unattended default), and
//   - `build-claude-pre-tool-use-hook` — the can't-be-skipped backstop
//     that forces these through `canUseTool` ('ask') even for a SUBAGENT
//     whose `permissionMode` is `bypassPermissions`/`dontAsk` and would
//     otherwise skip the prompt entirely (the safety invariant).
//
// Scope: the floor STANDS DOWN in `auto` and in the user's `bypass` — neither
// cards anything (bypass 2026-07-30 Chad; auto extended to the same rule by
// Kafi 2026-08-11, when an escalated approval hung a turn in the one mode that
// promises not to ask). The composer mode is the user's trust level for the
// whole turn, subagents included. The floor holds in ask/plan-only and in the
// unattended `bypass-with-behavior-gate` default.
//
// Hardcoded for Phase 1 — per-skill / per-agent configurability is a
// Phase 2 design (`docs/blueprints/providers/decisions.md` D12).
//
// `mcp__vynel__create_memory_entry` was removed 2026-07-26: Chad's refined
// approval stance — "Claude's self-tools (memory, knowledge, tasks) do NOT
// need approval" — supersedes the 2026-06-20 memory-writes-card directive.
// Vynel MCP approval now lives in the ask-mode destructive tier
// (`askModeApprovalToolNames`), never in this every-mode floor.

export const TOOLS_ALWAYS_REQUIRING_APPROVAL: ReadonlySet<string> = new Set([
  'Bash',
  'Write',
  'Edit',
  'NotebookEdit',
])
