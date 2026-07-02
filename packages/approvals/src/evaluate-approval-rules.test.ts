// Rule-engine tests. Pure-function coverage — no DB. Builds fake
// `ApprovalRule` rows inline since the engine doesn't care where the
// rules came from.

import { describe, expect, it } from 'vitest'
import { evaluateApprovalRules } from './evaluate-approval-rules.js'
import type { ApprovalRule, ApprovalRuleMatcher } from './approvals-types.js'

function makeRule(overrides: {
  isEnabled?: boolean
  matcher?: ApprovalRuleMatcher
  id?: string
}): ApprovalRule {
  const now = new Date('2026-05-24T00:00:00Z')
  return {
    id: overrides.id ?? '00000000-0000-0000-0000-000000000001',
    userId: '00000000-0000-0000-0000-0000000000aa',
    workspaceId: '00000000-0000-0000-0000-0000000000bb',
    ruleKind: overrides.matcher?.kind ?? 'auto-approve-action-kind',
    description: 'test rule',
    matcher: overrides.matcher ?? { kind: 'auto-approve-action-kind', actionKind: 'file-write' },
    isEnabled: overrides.isEnabled ?? true,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

describe('evaluateApprovalRules', () => {
  it('returns null when the workspace has no rules', () => {
    const result = evaluateApprovalRules({
      toolName: 'Write',
      actionKind: 'file-write',
      toolInput: { path: '/tmp/x' },
      workspaceRules: [],
    })
    expect(result).toBeNull()
  })

  it('matches when an auto-approve-action-kind rule equals the actionKind', () => {
    const rule = makeRule({
      matcher: { kind: 'auto-approve-action-kind', actionKind: 'file-write' },
    })
    const result = evaluateApprovalRules({
      toolName: 'Write',
      actionKind: 'file-write',
      toolInput: { path: '/tmp/x' },
      workspaceRules: [rule],
    })
    expect(result?.rule.id).toBe(rule.id)
  })

  it('does NOT match when an auto-approve-action-kind rule has a different actionKind', () => {
    const rule = makeRule({
      matcher: { kind: 'auto-approve-action-kind', actionKind: 'email-send' },
    })
    const result = evaluateApprovalRules({
      toolName: 'Write',
      actionKind: 'file-write',
      toolInput: { path: '/tmp/x' },
      workspaceRules: [rule],
    })
    expect(result).toBeNull()
  })

  it('matches when an auto-approve-tool-name rule equals the toolName exactly', () => {
    const rule = makeRule({
      matcher: { kind: 'auto-approve-tool-name', toolName: 'mcp__gmail__send' },
    })
    const result = evaluateApprovalRules({
      toolName: 'mcp__gmail__send',
      actionKind: 'email-send',
      toolInput: { to: 'a@b.com' },
      workspaceRules: [rule],
    })
    expect(result?.rule.id).toBe(rule.id)
  })

  it('does NOT match when an auto-approve-tool-name rule has a different toolName', () => {
    const rule = makeRule({
      matcher: { kind: 'auto-approve-tool-name', toolName: 'mcp__gmail__send' },
    })
    const result = evaluateApprovalRules({
      toolName: 'mcp__email__send',
      actionKind: 'email-send',
      toolInput: { to: 'a@b.com' },
      workspaceRules: [rule],
    })
    expect(result).toBeNull()
  })

  it('skips disabled rules even when they would match', () => {
    const rule = makeRule({
      isEnabled: false,
      matcher: { kind: 'auto-approve-action-kind', actionKind: 'file-write' },
    })
    const result = evaluateApprovalRules({
      toolName: 'Write',
      actionKind: 'file-write',
      toolInput: { path: '/tmp/x' },
      workspaceRules: [rule],
    })
    expect(result).toBeNull()
  })

  it('returns the first matching rule when several would match (deterministic by input order)', () => {
    const ruleA = makeRule({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      matcher: { kind: 'auto-approve-tool-name', toolName: 'Write' },
    })
    const ruleB = makeRule({
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      matcher: { kind: 'auto-approve-action-kind', actionKind: 'file-write' },
    })
    const result = evaluateApprovalRules({
      toolName: 'Write',
      actionKind: 'file-write',
      toolInput: { path: '/tmp/x' },
      workspaceRules: [ruleA, ruleB],
    })
    expect(result?.rule.id).toBe(ruleA.id)
  })

  it('ignores disabled rules and picks the next enabled match', () => {
    const disabled = makeRule({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      isEnabled: false,
      matcher: { kind: 'auto-approve-tool-name', toolName: 'Write' },
    })
    const enabled = makeRule({
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      matcher: { kind: 'auto-approve-action-kind', actionKind: 'file-write' },
    })
    const result = evaluateApprovalRules({
      toolName: 'Write',
      actionKind: 'file-write',
      toolInput: { path: '/tmp/x' },
      workspaceRules: [disabled, enabled],
    })
    expect(result?.rule.id).toBe(enabled.id)
  })

  it('does not throw on unknown matcher kinds (TS prevents this at compile time)', () => {
    // Exhaustiveness check — the `switch (matcher.kind)` covers both Phase 1
    // kinds. Adding a third kind in Phase 1.5 requires extending the switch.
    // This test pins the behavior so a future addition doesn't silently fall
    // through.
    const rule = makeRule({
      matcher: { kind: 'auto-approve-action-kind', actionKind: 'file-write' },
    })
    expect(() =>
      evaluateApprovalRules({
        toolName: 'Write',
        actionKind: 'file-write',
        toolInput: undefined,
        workspaceRules: [rule],
      }),
    ).not.toThrow()
  })
})
