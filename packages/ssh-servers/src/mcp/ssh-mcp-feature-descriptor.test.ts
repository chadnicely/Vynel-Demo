// Pins the ssh descriptor's policy surface. The tier map matters most: these
// handlers call package ops directly (no HTTP re-entry), so composition-level
// filtering is the ONLY tier gate on this server — a drift here silently hands
// a basic-tier agent run_ssh_command.

import { describe, expect, it } from 'vitest'
import { buildSshFeatureDescriptor } from './ssh-mcp-feature-descriptor.js'

describe('buildSshFeatureDescriptor', () => {
  const descriptor = buildSshFeatureDescriptor({ masterKeyBase64: 'AAAA' })

  it('declares the pro tier gate over BOTH tools (ssh is pro — Chad 2026-07-17)', () => {
    expect(descriptor.featureGatedTools).toEqual({
      ssh: ['mcp__vynel-ssh__list_ssh_servers', 'mcp__vynel-ssh__run_ssh_command'],
    })
  })

  it('keeps the no-cards stance and the server identity', () => {
    expect(descriptor.serverName).toBe('vynel-ssh')
    expect(descriptor.mutatingToolNames).toEqual([]) // NO cards — Chad's call
    expect(descriptor.askModeApprovalToolNames).toBeUndefined()
    // The declared inventory matches the tier map — every ssh tool is pro.
    expect(descriptor.toolNames).toEqual(descriptor.featureGatedTools?.['ssh'])
  })

  it('build() constructs the server without touching the DB', () => {
    const server = descriptor.build({
      db: {} as unknown,
      userId: 'user-1',
      appRequest: () => new Response('{}', { status: 200 }),
    })
    expect(server).not.toBeNull()
    expect(typeof server).toBe('object')
  })
})
