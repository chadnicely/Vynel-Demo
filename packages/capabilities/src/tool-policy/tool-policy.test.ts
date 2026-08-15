// Real-SQLite tests for the tool-policy data layer: the upsert-or-delete
// override save, its outbox co-commit, and the declared-defaults ⊕ overrides
// resolution.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import { insertUser } from '@vynel/db/repositories/users'
import { listUnprocessedOutboxEvents } from '@vynel/db/repositories/_shared'
import { findToolPolicy } from '../repositories/tool-policies.js'
import { resolveEffectiveToolPolicies } from './resolve-effective-tool-policies.js'
import { setToolPolicyOverride } from './set-tool-policy-override.js'
import type { ToolCatalogEntry } from './tool-policy-types.js'

function seedUser(db: Database): string {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }).id
}

const CATALOG: readonly ToolCatalogEntry[] = [
  {
    toolName: 'mcp__vynel__list_tasks',
    serverName: 'vynel',
    surfaces: ['workspace-interactive', 'workspace-background'],
    cardClass: 'never',
    capabilityId: 'tasks',
  },
  {
    toolName: 'mcp__vynel-ssh__run_ssh_command',
    serverName: 'vynel-ssh',
    surfaces: ['workspace-interactive', 'global-interactive'],
    cardClass: 'never',
    featureKey: 'ssh',
  },
]

const ALL_INHERIT = {
  enabled: null,
  cardClass: null,
  surfaces: null,
  featureKey: null,
  capabilityId: null,
} as const

describe('setToolPolicyOverride + resolveEffectiveToolPolicies', () => {
  it('defaults pass through untouched when no override rows exist', () => {
    withTestDatabase((db) => {
      const userId = seedUser(db)
      const effective = resolveEffectiveToolPolicies(db, { userId, catalog: CATALOG })
      const ssh = effective.get('mcp__vynel-ssh__run_ssh_command')!
      expect(ssh.enabled).toBe(true)
      expect(ssh.cardClass).toBe('never')
      expect(ssh.featureKey).toBe('ssh')
      expect(ssh.hasOverride).toBe(false)
      expect(effective.get('mcp__vynel__list_tasks')!.capabilityId).toBe('tasks')
    })
  })

  it('upserts an override, merges it, and co-commits the outbox event', () => {
    withTestDatabase((db) => {
      const userId = seedUser(db)
      const saved = setToolPolicyOverride(db, {
        userId,
        toolName: 'mcp__vynel-ssh__run_ssh_command',
        ...ALL_INHERIT,
        cardClass: 'always',
        surfaces: ['workspace-interactive'],
      })
      expect(saved).not.toBeNull()

      const effective = resolveEffectiveToolPolicies(db, { userId, catalog: CATALOG })
      const ssh = effective.get('mcp__vynel-ssh__run_ssh_command')!
      expect(ssh.cardClass).toBe('always')
      expect(ssh.surfaces).toEqual(['workspace-interactive'])
      expect(ssh.featureKey).toBe('ssh') // untouched column inherits
      expect(ssh.hasOverride).toBe(true)

      const events = listUnprocessedOutboxEvents(db, { types: ['tool-policy.updated'] })
      expect(events).toHaveLength(1)
    })
  })

  it("'none' on a gate column UNGATES; a second save fully replaces the first", () => {
    withTestDatabase((db) => {
      const userId = seedUser(db)
      setToolPolicyOverride(db, {
        userId,
        toolName: 'mcp__vynel__list_tasks',
        ...ALL_INHERIT,
        enabled: false,
      })
      setToolPolicyOverride(db, {
        userId,
        toolName: 'mcp__vynel__list_tasks',
        ...ALL_INHERIT,
        capabilityId: 'none',
      })
      const effective = resolveEffectiveToolPolicies(db, { userId, catalog: CATALOG })
      const tasks = effective.get('mcp__vynel__list_tasks')!
      // Full-replace: the earlier enabled=false did NOT survive the second save.
      expect(tasks.enabled).toBe(true)
      expect(tasks.capabilityId).toBeUndefined()
    })
  })

  it('an all-inherit save normalizes to reset — the row disappears', () => {
    withTestDatabase((db) => {
      const userId = seedUser(db)
      setToolPolicyOverride(db, {
        userId,
        toolName: 'mcp__vynel__list_tasks',
        ...ALL_INHERIT,
        enabled: false,
      })
      const cleared = setToolPolicyOverride(db, {
        userId,
        toolName: 'mcp__vynel__list_tasks',
        ...ALL_INHERIT,
      })
      expect(cleared).toBeNull()
      expect(findToolPolicy(db, { userId, toolName: 'mcp__vynel__list_tasks' })).toBeNull()
      const effective = resolveEffectiveToolPolicies(db, { userId, catalog: CATALOG })
      expect(effective.get('mcp__vynel__list_tasks')!.hasOverride).toBe(false)
    })
  })

  it("featureKey 'none' ungates the tier; an EMPTY surfaces override means nowhere (≠ inherit)", () => {
    withTestDatabase((db) => {
      const userId = seedUser(db)
      setToolPolicyOverride(db, {
        userId,
        toolName: 'mcp__vynel-ssh__run_ssh_command',
        ...ALL_INHERIT,
        featureKey: 'none',
        surfaces: [],
      })
      const effective = resolveEffectiveToolPolicies(db, { userId, catalog: CATALOG })
      const ssh = effective.get('mcp__vynel-ssh__run_ssh_command')!
      expect(ssh.featureKey).toBeUndefined()
      expect(ssh.surfaces).toEqual([])
    })
  })

  it('ignores an override for a tool the catalog no longer carries', () => {
    withTestDatabase((db) => {
      const userId = seedUser(db)
      setToolPolicyOverride(db, {
        userId,
        toolName: 'mcp__vynel__retired_tool',
        ...ALL_INHERIT,
        enabled: false,
      })
      const effective = resolveEffectiveToolPolicies(db, { userId, catalog: CATALOG })
      expect(effective.has('mcp__vynel__retired_tool')).toBe(false)
      expect(effective.size).toBe(CATALOG.length)
    })
  })
})
