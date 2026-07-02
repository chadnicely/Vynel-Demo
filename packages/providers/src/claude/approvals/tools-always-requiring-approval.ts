// The single source of truth for tools whose effects are irreversible
// enough to require an approval card EVEN under a bypass permission mode.
//
// Consumed by BOTH:
//   - `build-claude-can-use-tool-callback` — the main session's behavior
//     gate (cards these tools instead of running them silently under
//     `bypass-with-behavior-gate`), and
//   - `build-claude-pre-tool-use-hook` — the can't-be-skipped backstop
//     that forces these through `canUseTool` ('ask') even for a SUBAGENT
//     whose `permissionMode` is `bypassPermissions`/`dontAsk`/`auto` and
//     would otherwise skip the prompt entirely (the safety invariant).
//
// Hardcoded for Phase 1 — per-skill / per-agent configurability is a
// Phase 2 design (`docs/blueprints/providers/decisions.md` D12). Memory
// writes card by default per the 2026-06-20 user directive.

export const TOOLS_ALWAYS_REQUIRING_APPROVAL: ReadonlySet<string> = new Set([
  'Bash',
  'Write',
  'Edit',
  'NotebookEdit',
  'mcp__vynel__create_memory_entry',
])
