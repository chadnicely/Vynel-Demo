import { describe, it, expect } from 'vitest'
import type { SessionToolContext } from '@vynel/mcp-contract'
import { buildInProcessMcpServer } from './build-in-process-server.js'
import {
  vynelWorkspaceDescriptor,
  vynelWorkspaceInteractiveDescriptor,
  vynelRoutingDescriptor,
} from './vynel-mcp-feature-descriptor.js'

// A minimal SessionToolContext. Building the `vynel` server only CONSTRUCTS the
// tool objects (handlers close over scope + appRequest); it never queries the DB
// or dispatches a request until a tool is actually invoked — so stubs suffice.
function fakeContext(overrides: Partial<SessionToolContext> = {}): SessionToolContext {
  return {
    db: {} as unknown,
    userId: 'user-1',
    workspaceId: 'ws-1',
    appRequest: () => new Response('{}', { status: 200 }),
    ...overrides,
  }
}

describe('buildInProcessMcpServer', () => {
  it('builds a non-empty vynel MCP server from the generated registry', () => {
    const server = buildInProcessMcpServer(
      { db: {} as never, userId: 'user-1', workspaceId: 'ws-1' },
      () => new Response('{}', { status: 200 }),
    )
    // Building must not throw (proves the generated registry is non-empty and
    // every factory constructs) and yields an SDK server config object.
    expect(server).toBeDefined()
    expect(typeof server).toBe('object')
  })
})

describe('vynelWorkspaceDescriptor', () => {
  it('is a well-formed McpFeatureDescriptor for the vynel server', () => {
    expect(vynelWorkspaceDescriptor.serverName).toBe('vynel')
    // No vynel tool cards in EVERY mode — approval lives in the ask-mode tier.
    expect(vynelWorkspaceDescriptor.mutatingToolNames).toEqual([])
    // The ask-approval tier (DELETE routes + x-mcp.askApproval) cards in ask
    // mode only. The FULL set is pinned so a regenerate that drops ANY member
    // — e.g. register_workspace losing its route flag, the exact tool Chad
    // wants carded — fails loudly here.
    expect(vynelWorkspaceDescriptor.askModeApprovalToolNames).toEqual([
      'mcp__vynel__delete_agent',
      'mcp__vynel__register_workspace',
      'mcp__vynel__remove_knowledge_source',
      'mcp__vynel__uninstall_marketplace_item',
    ])
    expect(vynelWorkspaceInteractiveDescriptor.askModeApprovalToolNames).toEqual(
      vynelWorkspaceDescriptor.askModeApprovalToolNames,
    )
    expect(vynelRoutingDescriptor.askModeApprovalToolNames).toEqual(
      vynelWorkspaceDescriptor.askModeApprovalToolNames,
    )
    // `knowledge` and `memory` each gate their whole toolset (capability OFF →
    // none of its tools); the gate names use the mcp__vynel__ prefix.
    // test: correct expectation for memory gating — memory grew 6 MCP tools in
    // the 2026-07-11 tags round, so it now gates like knowledge (was: no entry).
    expect(vynelWorkspaceDescriptor.capabilityGatedTools?.knowledge).toContain(
      'mcp__vynel__search_knowledge',
    )
    expect(vynelWorkspaceDescriptor.capabilityGatedTools?.memory).toEqual([
      'mcp__vynel__list_memory_entries',
      'mcp__vynel__search_memory',
      'mcp__vynel__list_memory_tags',
      'mcp__vynel__create_memory_entry',
      'mcp__vynel__update_memory_entry',
      'mcp__vynel__add_memory_from_file',
    ])
    // `tasks` gates all five task tools (tasks module, 2026-07-17). The exact
    // list is pinned so a typo'd gate name can't silently leave a tool ungated
    // (the composer spec-tests the mechanism with fakes only).
    expect(vynelWorkspaceDescriptor.capabilityGatedTools?.tasks).toEqual([
      'mcp__vynel__list_tasks',
      'mcp__vynel__create_task',
      'mcp__vynel__update_task',
      'mcp__vynel__complete_task',
      'mcp__vynel__list_my_tasks',
    ])
    // `plans` and `journal` gate their whole toolsets the same way (plans +
    // journal modules, 2026-07-23). The journal agent door is append+read
    // only — exactly these three tools exist to gate.
    expect(vynelWorkspaceDescriptor.capabilityGatedTools?.plans).toEqual([
      'mcp__vynel__list_plans',
      'mcp__vynel__create_plan',
      'mcp__vynel__update_plan',
      'mcp__vynel__complete_plan',
      'mcp__vynel__list_my_plans',
    ])
    expect(vynelWorkspaceDescriptor.capabilityGatedTools?.journal).toEqual([
      'mcp__vynel__list_journal_entries',
      'mcp__vynel__add_journal_entry',
      'mcp__vynel__list_my_journal_entries',
    ])
  })

  it('contributes each capability discipline ONLY when that capability is enabled', () => {
    const context = fakeContext()
    const withTasks = vynelWorkspaceDescriptor.contributePrompt?.(context, new Set(['tasks']))
    expect(withTasks).toContain('list_tasks')
    expect(withTasks).toContain('complete_task')
    // Only the enabled capability's section — no plans/journal lines steering
    // the model into denied tools.
    expect(withTasks).not.toContain('create_plan')
    expect(withTasks).not.toContain('add_journal_entry')

    const withPlans = vynelWorkspaceDescriptor.contributePrompt?.(context, new Set(['plans']))
    expect(withPlans).toContain('create_plan')
    // The in-app deep-link teaching (the web shell's PlanViewDialog) rides
    // the plans section — present exactly when plans is on.
    expect(withPlans).toContain('vynel://plan/')
    expect(withPlans).not.toContain('list_tasks')

    const withJournal = vynelWorkspaceDescriptor.contributePrompt?.(context, new Set(['journal']))
    expect(withJournal).toContain('add_journal_entry')
    expect(withJournal).not.toContain('create_plan')

    // All three on → all three sections, stable order (tasks → plans → journal).
    const all = vynelWorkspaceDescriptor.contributePrompt?.(
      context,
      new Set(['tasks', 'plans', 'journal']),
    )
    expect(all).toContain('## Task list')
    expect(all).toContain('## Plans')
    expect(all).toContain('## Work journal')
    expect(all!.indexOf('## Task list')).toBeLessThan(all!.indexOf('## Plans'))
    expect(all!.indexOf('## Plans')).toBeLessThan(all!.indexOf('## Work journal'))

    // None of the prompt-bearing capabilities on (others on) → no standing
    // section at all. An undefined set (no capability info) also drops them.
    expect(vynelWorkspaceDescriptor.contributePrompt?.(context, new Set(['memory']))).toBeNull()
    expect(vynelWorkspaceDescriptor.contributePrompt?.(context)).toBeNull()
  })

  it('build() returns a live server for a workspace context', () => {
    const server = vynelWorkspaceDescriptor.build(fakeContext())
    expect(server).not.toBeNull()
    expect(typeof server).toBe('object')
  })
})

describe('vynelWorkspaceInteractiveDescriptor (Slice ④b)', () => {
  it('mirrors the workspace descriptor in everything but the toolset (same server key, gates, prompt)', () => {
    expect(vynelWorkspaceInteractiveDescriptor.serverName).toBe('vynel')
    // The spawning tools are mutatingApproved-auto (the "Claude manages
    // freely" precedent) — nothing new cards.
    expect(vynelWorkspaceInteractiveDescriptor.mutatingToolNames).toEqual([])
    // Same gate table object — capability toggles behave identically on both
    // workspace surfaces.
    expect(vynelWorkspaceInteractiveDescriptor.capabilityGatedTools).toBe(
      vynelWorkspaceDescriptor.capabilityGatedTools,
    )
    // Same standing guidance (one shared contributePrompt).
    const context = fakeContext()
    expect(vynelWorkspaceInteractiveDescriptor.contributePrompt?.(context, new Set(['tasks']))).toBe(
      vynelWorkspaceDescriptor.contributePrompt?.(context, new Set(['tasks'])),
    )
  })

  it('build() returns a live server for a workspace context', () => {
    const server = vynelWorkspaceInteractiveDescriptor.build(fakeContext())
    expect(server).not.toBeNull()
    expect(typeof server).toBe('object')
  })
})
