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
  it('declares both act tools in the ask-approval tier (element + coordinate acting)', () => {
    expect(desktopFeatureDescriptor.serverName).toBe('desktop')
    // The consent tool cards in EVERY mode (mutating tier): a grant coming
    // into being without the user seeing a card would hollow out the per-app
    // access model. The act tools stay ask-tier (Chad 2026-07-26: "ask mode
    // gates through approval; auto and bypass, no approval").
    expect(desktopFeatureDescriptor.mutatingToolNames).toEqual([
      'mcp__desktop__request_desktop_access',
    ])
    expect(desktopFeatureDescriptor.askModeApprovalToolNames).toEqual([
      'mcp__desktop__act_on_app',
      'mcp__desktop__act_on_desktop',
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
