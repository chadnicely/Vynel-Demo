// `tool-approval-policy.ts` — THE single home for Vynel's mode × tool approval
// matrix. `build-claude-can-use-tool-callback` (the card gate) and
// `build-claude-pre-tool-use-hook` (the can't-be-skipped backstop) both derive
// their decisions from here, so gate and backstop cannot drift.
//
// MODE SEMANTICS (the recorded directives, moved here from the two consumers):
// - `ask` / `plan-only`: the floor + per-turn mutating set + the ask-mode
//   destructive tier all card. Every OTHER MCP tool resolves ALLOW from this
//   map — the deliberate replacement for the old `mcp__<server>__*` wildcard
//   pre-approval, which auto-approved whole servers upstream of `canUseTool`
//   (the CLAUDE_SDK_CAN_USE_TOOL_SHADOWED bug). Native tools the SDK routes to
//   the callback in ask mode keep carding, exactly as before.
// - `auto`: NO card, ever — auto means no approval needed (Kafi 2026-08-11,
//   superseding "the classifier's uncertain escalations card via canUseTool":
//   an escalation parked a desktop turn on a card the user never expected in a
//   mode that promises not to ask). At this layer auto equals bypass; the
//   SDK's own classifier still shapes what runs.
// - `bypass` (the user's composer pick, Chad 2026-07-30): nothing cards, ever.
//   `canUseTool` is genuinely dead here — the runner does not even bind it.
// - `bypass-with-behavior-gate` (the UNATTENDED default — schedules, delegated
//   leaves, report delivery): the floor + per-turn mutating set card and park
//   for the user (surface-up approval); everything else runs uncarded. A
//   background turn carries no user trust pick, so the floor holds.

import type { ClaudePermissionMode } from '../../shared/start-chat-session-input.js'
import { TOOLS_ALWAYS_REQUIRING_APPROVAL } from './tools-always-requiring-approval.js'

export type ToolApprovalSets = {
  /** Per-turn feature mutating tools, UNIONED with the static floor — a tool
   *  in either set cards in every carding mode. ADDITIVE; omitting it never
   *  drops the static floor. */
  alwaysRequireApprovalToolNames?: ReadonlySet<string> | undefined
  /** The ask-mode destructive tier — cards only under `ask` / `plan-only`. */
  askModeApprovalToolNames?: ReadonlySet<string> | undefined
  /** The server names of the turn's COMPOSED in-process MCP servers (the
   *  descriptor set the composer registered). Only THEIR tools inherit the
   *  ask-mode map-allow that replaced the per-server wildcard. An external
   *  server the CLI loaded from settings (marketplace installs into
   *  `~/.claude.json` / `<workspace>/.mcp.json`) never had a wildcard — its
   *  tools carded in ask mode before the re-plumb and must keep carding. */
  composedMcpServerNames?: ReadonlySet<string> | undefined
}

/** True when the tool belongs to one of the turn's composed servers
 *  (`mcp__<server>__<tool>`). A startsWith match per name — server names are
 *  few and never contain `__`, so no parsing ambiguity. */
function isComposedMcpTool(toolName: string, sets: ToolApprovalSets): boolean {
  if (sets.composedMcpServerNames === undefined) return false
  for (const serverName of sets.composedMcpServerNames) {
    if (toolName.startsWith(`mcp__${serverName}__`)) return true
  }
  return false
}

/** `auto` + the user's `bypass`: no Vynel card, ever. */
export function approvalFloorStandsDown(mode: ClaudePermissionMode): boolean {
  return mode === 'auto' || mode === 'bypass'
}

/** The ask-mode destructive tier applies under `ask`, and `plan-only`
 *  DEFENSIVELY: nothing routes plan-only today, but a card there is strictly
 *  safer than an uncarded delete from a mode documented as non-executing. */
export function destructiveAskTierApplies(mode: ClaudePermissionMode): boolean {
  return mode === 'ask' || mode === 'plan-only'
}

/** Static floor ∪ the per-turn mutating set — cards in every carding mode. */
export function isAlwaysCardTool(toolName: string, sets: ToolApprovalSets): boolean {
  return (
    TOOLS_ALWAYS_REQUIRING_APPROVAL.has(toolName) ||
    (sets.alwaysRequireApprovalToolNames?.has(toolName) ?? false)
  )
}

/**
 * The PreToolUse backstop condition: must this call be FORCED into
 * `canUseTool` (`permissionDecision: 'ask'`) even when the (sub)agent's own
 * permission mode would skip the callback? Deliberately NARROWER than
 * `decideCanUseTool`'s 'card' — the backstop exists to rescue the floor +
 * declared tiers from skip-modes (a `bypassPermissions` subagent), never to
 * widen what cards: forcing every ask-mode native fall-through here would
 * make a subagent's ordinary tools card, which today they do not.
 */
export function requiresApprovalCardBackstop(
  toolName: string,
  mode: ClaudePermissionMode,
  sets: ToolApprovalSets,
): boolean {
  if (approvalFloorStandsDown(mode)) return false
  if (isAlwaysCardTool(toolName, sets)) return true
  return (
    destructiveAskTierApplies(mode) && (sets.askModeApprovalToolNames?.has(toolName) ?? false)
  )
}

export type CanUseToolDecision = 'allow' | 'card'

/**
 * The `canUseTool` decision for a call that reached the callback. 'allow'
 * resolves `{ behavior: 'allow' }` immediately (the map check); 'card'
 * registers a pending approval and parks the agent on the user's decision.
 */
export function decideCanUseTool(
  toolName: string,
  mode: ClaudePermissionMode,
  sets: ToolApprovalSets,
): CanUseToolDecision {
  if (approvalFloorStandsDown(mode)) return 'allow'
  if (mode === 'bypass-with-behavior-gate') {
    return isAlwaysCardTool(toolName, sets) ? 'card' : 'allow'
  }
  // ask | plan-only
  if (isAlwaysCardTool(toolName, sets)) return 'card'
  if (sets.askModeApprovalToolNames?.has(toolName) ?? false) return 'card'
  // A COMPOSED server's tool outside every declared tier resolves allow — the
  // map replaces that server's old wildcard pre-approval one-for-one (reads +
  // Claude's self-tools: memory, knowledge, tasks — Chad 2026-07-26 "do NOT
  // need approval"). An EXTERNAL server's tool falls through and cards, as it
  // always did (no wildcard ever covered it).
  if (isComposedMcpTool(toolName, sets)) return 'allow'
  // Native tools and external-server MCP tools card in ask mode, as always.
  return 'card'
}
