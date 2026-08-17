import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import type { SessionToolContext } from '@vynel/mcp-contract'
import { insertUser } from '@vynel/db/repositories/users'
import { createInstructionDocument } from '../lifecycle/create-instruction-document.js'
import {
  notebookFeatureDescriptor,
  NOTEBOOK_PROMPT_INSTRUCTIONS,
} from './notebook-mcp-feature-descriptor.js'
import { buildListPlaybooksResponse } from './list-playbooks-tool.js'
import { buildReadPlaybookResponse } from './read-playbook-tool.js'

function seedUser(db: Database) {
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
  })
}

describe('notebookFeatureDescriptor', () => {
  it('declares the read-only vynel-notebook server: NO mutating tools (settled fork #1)', () => {
    expect(notebookFeatureDescriptor.serverName).toBe('vynel-notebook')
    expect(notebookFeatureDescriptor.mutatingToolNames).toEqual([])
  })

  it('gates both tools behind the notebook capability', () => {
    expect(notebookFeatureDescriptor.capabilityGatedTools).toEqual({
      notebook: ['mcp__vynel-notebook__list_playbooks', 'mcp__vynel-notebook__read_playbook'],
    })
  })

  it('contributes the one standing notebook line', () => {
    const context: SessionToolContext = { db: {}, userId: 'u', appRequest: () => new Response() }
    expect(notebookFeatureDescriptor.contributePrompt?.(context)).toBe(
      NOTEBOOK_PROMPT_INSTRUCTIONS,
    )
    expect(NOTEBOOK_PROMPT_INSTRUCTIONS).toContain('list_playbooks')
  })

  it('builds a server on both a workspace turn and a global-root turn (no workspaceId)', async () => {
    await withTestDatabase((db) => {
      const base: SessionToolContext = { db, userId: 'u', appRequest: () => new Response() }
      expect(notebookFeatureDescriptor.build(base)).not.toBeNull()
      expect(
        notebookFeatureDescriptor.build({ ...base, workspaceId: randomUUID() }),
      ).not.toBeNull()
    })
  })
})

describe('the tool responses', () => {
  it('list_playbooks returns verified + user books with the verified flag', async () => {
    await withTestDatabase((db) => {
      const user = seedUser(db)
      createInstructionDocument(db, {
        userId: user.id,
        scope: 'global',
        title: 'House rules',
        body: 'Always confirm first.',
      })
      const response = buildListPlaybooksResponse(db, { userId: user.id })
      const parsed = JSON.parse(response.content[0]!.text) as {
        count: number
        playbooks: Array<{ id: string; verified: boolean }>
      }
      // test: correct expectation — was 3 verified books, now 11: the
      // notebook arc (2026-07-27) added project-kickoff, node-app-scaffold,
      // node-mcp-server, node-sdk, vue/nuxt-frontend, and task-planner; the
      // desktop-control polish arc (2026-08-11) added driving-the-desktop; the
      // continuity arc (2026-08-18) added session-continuity.
      expect(parsed.count).toBe(12)
      expect(parsed.playbooks.filter((p) => p.verified)).toHaveLength(11)
      expect(parsed.playbooks.filter((p) => !p.verified)).toHaveLength(1)
    })
  })

  it('read_playbook returns the body for a known id and a clear error for an unknown one', async () => {
    await withTestDatabase((db) => {
      const user = seedUser(db)
      const ok = buildReadPlaybookResponse(db, { userId: user.id }, 'web-app-scaffold')
      expect(ok.isError).toBeUndefined()
      expect(JSON.parse(ok.content[0]!.text).body).toContain('Clarify the requirements')

      const missing = buildReadPlaybookResponse(db, { userId: user.id }, 'no-such-book')
      expect(missing.isError).toBe(true)
      expect(missing.content[0]!.text).toContain('no-such-book')
      expect(missing.content[0]!.text).toContain('list_playbooks')
    })
  })
})
