import { describe, expect, it } from 'vitest'
import { describeApprovalRule } from './describe-approval-rule.js'

describe('describeApprovalRule', () => {
  it('describes an auto-approve-action-kind matcher with the labels map', () => {
    expect(
      describeApprovalRule({ kind: 'auto-approve-action-kind', actionKind: 'email-send' }),
    ).toBe('Always allow send emails in this workspace')
  })

  it('describes file-write', () => {
    expect(
      describeApprovalRule({ kind: 'auto-approve-action-kind', actionKind: 'file-write' }),
    ).toBe('Always allow write files in this workspace')
  })

  it('describes shell-command', () => {
    expect(
      describeApprovalRule({ kind: 'auto-approve-action-kind', actionKind: 'shell-command' }),
    ).toBe('Always allow run shell commands in this workspace')
  })

  it('describes memory-write', () => {
    expect(
      describeApprovalRule({ kind: 'auto-approve-action-kind', actionKind: 'memory-write' }),
    ).toBe('Always allow update memory in this workspace')
  })

  it('describes other with the generic fallback', () => {
    expect(describeApprovalRule({ kind: 'auto-approve-action-kind', actionKind: 'other' })).toBe(
      'Always allow take this kind of action in this workspace',
    )
  })

  it('describes an auto-approve-tool-name matcher with the literal tool name', () => {
    expect(
      describeApprovalRule({ kind: 'auto-approve-tool-name', toolName: 'mcp__gmail__send' }),
    ).toBe('Always allow mcp__gmail__send in this workspace')
  })

  it('describes Claude built-in tool names', () => {
    expect(describeApprovalRule({ kind: 'auto-approve-tool-name', toolName: 'Write' })).toBe(
      'Always allow Write in this workspace',
    )
  })
})
