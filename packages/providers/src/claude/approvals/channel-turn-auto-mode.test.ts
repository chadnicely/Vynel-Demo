// VERIFICATION suite (channels fix arc, agent B): a Telegram-originated turn
// must never park on an approval card the user cannot see.
//
// This file pins the SECOND link of that chain — the mode × tool matrix under
// `auto`, the mode `DEFAULT_SESSION_MODE` resolves to for every channel turn
// whose global row carries no explicit pick (session-hardening D1/D3, and the
// memory-level rule "auto means auto — no card in auto").
//
// The existing `tool-approval-policy.test.ts` asserts the rule with SAMPLE
// tools. These cases sweep the WHOLE static floor plus a per-turn mutating set
// and the ask tier, so a floor grown in `tools-always-requiring-approval.ts`
// cannot silently acquire a card under `auto` — the exact regression that would
// re-park a Telegram turn on an invisible decision.
//
// The `ask` contrast is deliberate and NOT a bug report: D1 records that a
// channel turn honours the global row's stored mode when it has one, so `ask`
// carding here is the shipped decision. The visibility of that card is covered
// at the channels layer (`process-inbound-message.test.ts`).

import { describe, expect, it } from 'vitest'
import {
  decideCanUseTool,
  requiresApprovalCardBackstop,
  approvalFloorStandsDown,
} from './tool-approval-policy.js'
import { TOOLS_ALWAYS_REQUIRING_APPROVAL } from './tools-always-requiring-approval.js'

// A channel turn's real shape: the brain's composed servers, a per-turn
// mutating set from their descriptors, and the ask-mode destructive tier.
const CHANNEL_TURN_SETS = {
  alwaysRequireApprovalToolNames: new Set([
    'mcp__vynel__register_workspace',
    'mcp__desktop__act_on_app',
  ]),
  askModeApprovalToolNames: new Set(['mcp__vynel__delete_workspace']),
  composedMcpServerNames: new Set(['vynel', 'vynel-notebook', 'vynel-session', 'desktop']),
} as const

const FLOOR = [...TOOLS_ALWAYS_REQUIRING_APPROVAL]

describe('the channel turn under `auto` — no card can reach an unwatched Telegram user', () => {
  it('the floor stands down entirely', () => {
    expect(approvalFloorStandsDown('auto')).toBe(true)
    // Guards the floor being non-empty: an empty set would make the sweep below
    // pass vacuously.
    expect(FLOOR.length).toBeGreaterThan(0)
  })

  it.each(FLOOR)('`%s` (static floor) resolves ALLOW and is never forced by the backstop', (toolName) => {
    expect(decideCanUseTool(toolName, 'auto', CHANNEL_TURN_SETS)).toBe('allow')
    expect(requiresApprovalCardBackstop(toolName, 'auto', CHANNEL_TURN_SETS)).toBe(false)
  })

  it.each([...CHANNEL_TURN_SETS.alwaysRequireApprovalToolNames])(
    '`%s` (per-turn mutating set) resolves ALLOW and is never forced by the backstop',
    (toolName) => {
      expect(decideCanUseTool(toolName, 'auto', CHANNEL_TURN_SETS)).toBe('allow')
      expect(requiresApprovalCardBackstop(toolName, 'auto', CHANNEL_TURN_SETS)).toBe(false)
    },
  )

  it('the ask-mode destructive tier, native tools and an EXTERNAL server all resolve ALLOW too', () => {
    for (const toolName of [
      'mcp__vynel__delete_workspace', // the ask tier
      'Read', // a native tool the SDK routes to the callback
      'mcp__some-marketplace-server__push', // an external (settings-loaded) server
    ]) {
      expect(decideCanUseTool(toolName, 'auto', CHANNEL_TURN_SETS)).toBe('allow')
      expect(requiresApprovalCardBackstop(toolName, 'auto', CHANNEL_TURN_SETS)).toBe(false)
    }
  })

  it('missing per-turn sets (the conditional-spread shape) change nothing under auto', () => {
    for (const toolName of [...FLOOR, 'mcp__vynel__anything']) {
      expect(decideCanUseTool(toolName, 'auto', {})).toBe('allow')
      expect(requiresApprovalCardBackstop(toolName, 'auto', {})).toBe(false)
    }
  })
})

describe('the same turn under `ask` — the shipped D1 behaviour, kept visible', () => {
  // Not a regression: D1 says a channel turn runs the global row's mode when
  // the user set one. This pins that the DIFFERENCE is real, so a change that
  // collapses auto and ask into one branch fails loudly here.
  it.each(FLOOR)('`%s` cards under ask (the floor holds where the mode asks)', (toolName) => {
    expect(decideCanUseTool(toolName, 'ask', CHANNEL_TURN_SETS)).toBe('card')
    expect(requiresApprovalCardBackstop(toolName, 'ask', CHANNEL_TURN_SETS)).toBe(true)
  })

  it('the ask tier cards under ask but a composed read stays uncarded', () => {
    expect(decideCanUseTool('mcp__vynel__delete_workspace', 'ask', CHANNEL_TURN_SETS)).toBe('card')
    expect(decideCanUseTool('mcp__vynel__list_workspaces', 'ask', CHANNEL_TURN_SETS)).toBe('allow')
  })
})

describe('the channel REPLY tool is uncarded in EVERY mode', () => {
  // `reply_to_channel` is how a channel turn speaks back at all. A card on it
  // would park the turn on a decision the Telegram user is waiting for the
  // answer to — the deadlock this whole arc exists to prevent. Its catalog
  // cardClass is `never` (asserted in
  // `apps/local-api/src/services/channels-approval-verification.test.ts`);
  // this pins the policy side: it is in no card tier, so no mode reaches it.
  const MODES = ['auto', 'bypass', 'bypass-with-behavior-gate', 'ask', 'plan-only'] as const

  it.each(MODES)('resolves ALLOW under `%s`', (mode) => {
    expect(decideCanUseTool('mcp__vynel__reply_to_channel', mode, CHANNEL_TURN_SETS)).toBe('allow')
    expect(requiresApprovalCardBackstop('mcp__vynel__reply_to_channel', mode, CHANNEL_TURN_SETS)).toBe(
      false,
    )
  })

  it('is absent from the static floor', () => {
    expect(TOOLS_ALWAYS_REQUIRING_APPROVAL.has('mcp__vynel__reply_to_channel')).toBe(false)
  })
})
