import { describe, it, expect } from 'vitest'
import type { SessionToolContext } from '@vynel/mcp-contract'
import { desktopFeatureDescriptor } from './desktop-mcp-feature-descriptor.js'
import { DESKTOP_TOOL_INSTRUCTIONS, DESKTOP_ACT_INSTRUCTIONS } from './desktop-tool-instructions.js'

// `build()` only closes over the reader (the tool handlers read it later), so a
// structural stand-in is enough to assert shape + buildability.
const baseContext: SessionToolContext = {
  db: {},
  userId: 'user-1',
  appRequest: () => new Response(),
}

describe('desktopFeatureDescriptor', () => {
  it('declares the PLAN as the ask-approval tier — the act tools left it (plan-level approval)', () => {
    expect(desktopFeatureDescriptor.serverName).toBe('desktop')
    // The standing-grant consent tool keeps the MUTATING tier: it cards in ask
    // + the unattended background default (no silent self-grant on a schedule
    // fire), and runs uncarded in the user's auto/bypass. The ask tier holds
    // ONLY `propose_desktop_plan` (Kafi 2026-08-11: one card per task, on the
    // plan) — the act tools are gated in-tool by the plan envelope instead, so
    // their presence here would re-create the per-step cards the plan removed.
    expect(desktopFeatureDescriptor.mutatingToolNames).toEqual([
      'mcp__desktop__request_desktop_access',
    ])
    expect(desktopFeatureDescriptor.askModeApprovalToolNames).toEqual([
      'mcp__desktop__propose_desktop_plan',
    ])
  })

  it('is not capability-gated (gated by reader presence + the env flag instead)', () => {
    expect(desktopFeatureDescriptor.capabilityGatedTools).toBeUndefined()
  })

  it('returns null when no desktop reader is present (the feature is not applicable)', () => {
    expect(desktopFeatureDescriptor.build(baseContext)).toBeNull()
  })

  it('builds a server when a reader is present', () => {
    const server = desktopFeatureDescriptor.build({ ...baseContext, desktopReader: {} })
    expect(server).not.toBeNull()
  })

  it('contributes the observe-only prompt when actions are off', () => {
    expect(desktopFeatureDescriptor.contributePrompt?.(baseContext)).toBe(DESKTOP_TOOL_INSTRUCTIONS)
    expect(
      desktopFeatureDescriptor.contributePrompt?.({ ...baseContext, enableDesktopActions: false }),
    ).toBe(DESKTOP_TOOL_INSTRUCTIONS)
  })

  it('appends the act prompt when actions are enabled', () => {
    expect(
      desktopFeatureDescriptor.contributePrompt?.({ ...baseContext, enableDesktopActions: true }),
    ).toBe(`${DESKTOP_TOOL_INSTRUCTIONS}\n\n${DESKTOP_ACT_INSTRUCTIONS}`)
  })
})
