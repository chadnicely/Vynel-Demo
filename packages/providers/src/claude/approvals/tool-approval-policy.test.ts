// The mode × tool approval matrix — the one policy home both `canUseTool`
// and the PreToolUse backstop derive from. Pins today's de-facto behavior
// (the behavior-neutral re-plumb): reads + undeclared MCP tools never card,
// the ask tier cards in ask/plan-only, the floor ∪ mutating set cards in
// every carding mode, auto + the user's bypass never card anything.

import { describe, expect, it } from 'vitest'
import type { ClaudePermissionMode } from '../../shared/start-chat-session-input.js'
import {
  decideCanUseTool,
  requiresApprovalCardBackstop,
  type ToolApprovalSets,
} from './tool-approval-policy.js'

const sets: ToolApprovalSets = {
  alwaysRequireApprovalToolNames: new Set(['mcp__desktop__act_on_app']),
  askModeApprovalToolNames: new Set(['mcp__vynel__delete_agent']),
  composedMcpServerNames: new Set(['vynel', 'desktop']),
}

const FLOOR_NATIVE = 'Bash'
const MUTATING_MCP = 'mcp__desktop__act_on_app'
const ASK_TIER_MCP = 'mcp__vynel__delete_agent'
const PLAIN_MCP = 'mcp__vynel__list_tasks'
// An external settings-loaded server (marketplace install) — NOT composed.
const EXTERNAL_MCP = 'mcp__gmail__send_email'
const PLAIN_NATIVE = 'WebFetch'

const ALL_MODES: readonly ClaudePermissionMode[] = [
  'ask',
  'auto',
  'bypass',
  'bypass-with-behavior-gate',
  'plan-only',
]

describe('decideCanUseTool', () => {
  it('auto and the user bypass allow EVERYTHING — no card, ever', () => {
    for (const mode of ['auto', 'bypass'] as const) {
      for (const tool of [
        FLOOR_NATIVE,
        MUTATING_MCP,
        ASK_TIER_MCP,
        PLAIN_MCP,
        EXTERNAL_MCP,
        PLAIN_NATIVE,
      ]) {
        expect(decideCanUseTool(tool, mode, sets), `${mode}:${tool}`).toBe('allow')
      }
    }
  })

  it('bypass-with-behavior-gate cards only the floor ∪ mutating set', () => {
    expect(decideCanUseTool(FLOOR_NATIVE, 'bypass-with-behavior-gate', sets)).toBe('card')
    expect(decideCanUseTool(MUTATING_MCP, 'bypass-with-behavior-gate', sets)).toBe('card')
    // The ask tier stays uncarded in the unattended default (today's stance).
    expect(decideCanUseTool(ASK_TIER_MCP, 'bypass-with-behavior-gate', sets)).toBe('allow')
    expect(decideCanUseTool(PLAIN_MCP, 'bypass-with-behavior-gate', sets)).toBe('allow')
    // External servers were blanket-allowed by bypassPermissions before; the
    // unattended default keeps allowing them.
    expect(decideCanUseTool(EXTERNAL_MCP, 'bypass-with-behavior-gate', sets)).toBe('allow')
    expect(decideCanUseTool(PLAIN_NATIVE, 'bypass-with-behavior-gate', sets)).toBe('allow')
  })

  for (const mode of ['ask', 'plan-only'] as const) {
    it(`${mode} cards the declared tiers, allows composed MCP, cards the rest`, () => {
      expect(decideCanUseTool(FLOOR_NATIVE, mode, sets)).toBe('card')
      expect(decideCanUseTool(MUTATING_MCP, mode, sets)).toBe('card')
      expect(decideCanUseTool(ASK_TIER_MCP, mode, sets)).toBe('card')
      // The map-check that replaced the mcp__<server>__* wildcard: a COMPOSED
      // server's tool outside every declared tier resolves allow (reads +
      // Claude's self-tools — memory, knowledge, tasks — per the stance).
      expect(decideCanUseTool(PLAIN_MCP, mode, sets)).toBe('allow')
      // An EXTERNAL (settings-loaded) server never had a wildcard — its tools
      // carded in ask before the re-plumb and must keep carding.
      expect(decideCanUseTool(EXTERNAL_MCP, mode, sets)).toBe('card')
      // A NATIVE tool the SDK routes to the callback keeps carding.
      expect(decideCanUseTool(PLAIN_NATIVE, mode, sets)).toBe('card')
    })
  }

  it('treats missing sets as empty (the conditional-spread shape at every turn site)', () => {
    // No composed servers declared → nothing inherits the map-allow: every
    // MCP tool cards in ask, exactly the pre-wildcard world for a bare turn.
    expect(decideCanUseTool(PLAIN_MCP, 'ask', {})).toBe('card')
    expect(decideCanUseTool(FLOOR_NATIVE, 'ask', {})).toBe('card')
    expect(decideCanUseTool(FLOOR_NATIVE, 'bypass-with-behavior-gate', {})).toBe('card')
    expect(decideCanUseTool(PLAIN_MCP, 'bypass-with-behavior-gate', {})).toBe('allow')
  })
})

describe('requiresApprovalCardBackstop', () => {
  it('stands down entirely in auto and the user bypass', () => {
    for (const mode of ['auto', 'bypass'] as const) {
      for (const tool of [FLOOR_NATIVE, MUTATING_MCP, ASK_TIER_MCP, PLAIN_MCP, PLAIN_NATIVE]) {
        expect(requiresApprovalCardBackstop(tool, mode, sets), `${mode}:${tool}`).toBe(false)
      }
    }
  })

  it('rescues the floor ∪ mutating set wherever the floor holds', () => {
    for (const mode of ['ask', 'plan-only', 'bypass-with-behavior-gate'] as const) {
      expect(requiresApprovalCardBackstop(FLOOR_NATIVE, mode, sets), mode).toBe(true)
      expect(requiresApprovalCardBackstop(MUTATING_MCP, mode, sets), mode).toBe(true)
    }
  })

  it('rescues the ask tier only under ask/plan-only', () => {
    expect(requiresApprovalCardBackstop(ASK_TIER_MCP, 'ask', sets)).toBe(true)
    expect(requiresApprovalCardBackstop(ASK_TIER_MCP, 'plan-only', sets)).toBe(true)
    expect(requiresApprovalCardBackstop(ASK_TIER_MCP, 'bypass-with-behavior-gate', sets)).toBe(
      false,
    )
  })

  it('never forces undeclared tools — a skip-mode subagent keeps its ordinary tools uncarded', () => {
    for (const mode of ALL_MODES) {
      expect(requiresApprovalCardBackstop(PLAIN_MCP, mode, sets), mode).toBe(false)
      expect(requiresApprovalCardBackstop(EXTERNAL_MCP, mode, sets), mode).toBe(false)
      expect(requiresApprovalCardBackstop(PLAIN_NATIVE, mode, sets), mode).toBe(false)
    }
  })

  it('is never WIDER than the callback decision — a forced call always cards there', () => {
    // The backstop routes a call INTO canUseTool; if the callback would then
    // allow it, the rescue was pointless churn. Drift guard between the two.
    for (const mode of ALL_MODES) {
      for (const tool of [
        FLOOR_NATIVE,
        MUTATING_MCP,
        ASK_TIER_MCP,
        PLAIN_MCP,
        EXTERNAL_MCP,
        PLAIN_NATIVE,
      ]) {
        if (requiresApprovalCardBackstop(tool, mode, sets)) {
          expect(decideCanUseTool(tool, mode, sets), `${mode}:${tool}`).toBe('card')
        }
      }
    }
  })
})
