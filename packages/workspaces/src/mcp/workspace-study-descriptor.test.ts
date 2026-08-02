// Tests for the study descriptor's composition contract: applicability,
// read-only declaration, and the per-message prompt framing. (The tool LOGIC
// — guards, caps, gating — is tested directly in workspace-study-tools.test.ts.)

import { describe, expect, it } from 'vitest'
import type { SessionToolContext } from '@vynel/mcp-contract'
import { buildWorkspaceStudyDescriptor } from './workspace-study-descriptor.js'

const context: SessionToolContext = {
  db: null,
  userId: 'u-1',
  appRequest: () => new Response(null),
}

const acme = { id: 'ws-1', name: 'Acme', path: '/tmp/acme', managerName: 'Mark' }
const zen = { id: 'ws-2', name: 'Zen Garden', path: '/tmp/zen', managerName: 'Ava' }

describe('buildWorkspaceStudyDescriptor', () => {
  it('an empty set composes nothing (isApplicable false, build null, no prompt)', () => {
    const descriptor = buildWorkspaceStudyDescriptor({ workspaces: [] })
    expect(descriptor.isApplicable?.(context)).toBe(false)
    expect(descriptor.build(context)).toBeNull()
    expect(descriptor.contributePrompt?.(context)).toBeNull()
  })

  it('a non-empty set builds the server under the expected name, read-only', () => {
    const descriptor = buildWorkspaceStudyDescriptor({ workspaces: [acme, zen] })
    expect(descriptor.serverName).toBe('vynel-workspace-study')
    expect(descriptor.isApplicable?.(context)).toBe(true)
    expect(descriptor.mutatingToolNames).toEqual([])
    expect(descriptor.askModeApprovalToolNames).toBeUndefined()
    expect(descriptor.build(context)).not.toBeNull()
  })

  it('the prompt names every granted workspace with its id and the per-message rule', () => {
    const descriptor = buildWorkspaceStudyDescriptor({ workspaces: [acme, zen] })
    const prompt = descriptor.contributePrompt?.(context)
    expect(prompt).toContain('"Acme" (workspaceId: ws-1)')
    expect(prompt).toContain('"Zen Garden" (workspaceId: ws-2)')
    expect(prompt).toContain('THIS message only')
    expect(prompt).toContain('read-only')
  })
})
