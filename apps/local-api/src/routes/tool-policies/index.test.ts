// Integration tests for the `/tool-policies` routes — full HTTP stack against
// real SQLite, and the OpenAPI guard that keeps this surface agent-invisible.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })

function seedUser(db: Parameters<Parameters<typeof withTestDatabase>[0]>[0]) {
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

const ALL_INHERIT_BODY = {
  enabled: null,
  cardClass: null,
  surfaces: null,
  featureKey: null,
  capabilityId: null,
}

describe('tool-policies routes', () => {
  it('GET / returns the full effective matrix (defaults, no overrides)', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request('/tool-policies')
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        tools: Array<{ toolName: string; serverName: string; hasOverride: boolean }>
      }
      // Every server the catalog declares shows up, desktop included.
      const servers = new Set(body.tools.map((tool) => tool.serverName))
      for (const server of ['vynel', 'vynel-notebook', 'vynel-ask', 'desktop', 'vynel-ssh']) {
        expect(servers, server).toContain(server)
      }
      expect(body.tools.every((tool) => !tool.hasOverride)).toBe(true)
    })
  })

  it('PUT saves an override, the matrix reflects it, DELETE resets it', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = createApp({ db, logger: silentLogger })
      const put = await app.request('/tool-policies/mcp__vynel-ssh__run_ssh_command', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...ALL_INHERIT_BODY, cardClass: 'always', featureKey: 'none' }),
      })
      expect(put.status).toBe(200)
      const saved = (await put.json()) as {
        cardClass: string
        featureKey?: string
        hasOverride: boolean
      }
      expect(saved.cardClass).toBe('always')
      expect(saved.featureKey).toBeUndefined() // 'none' ungated the pro tier
      expect(saved.hasOverride).toBe(true)

      const reset = await app.request('/tool-policies/mcp__vynel-ssh__run_ssh_command', {
        method: 'DELETE',
      })
      expect(reset.status).toBe(200)
      const defaulted = (await reset.json()) as {
        cardClass: string
        featureKey?: string
        hasOverride: boolean
      }
      expect(defaulted.cardClass).toBe('never')
      expect(defaulted.featureKey).toBe('ssh')
      expect(defaulted.hasOverride).toBe(false)
    })
  })

  it('404s an unknown tool and 400s a bad body', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = createApp({ db, logger: silentLogger })
      const unknown = await app.request('/tool-policies/mcp__vynel__no_such_tool', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(ALL_INHERIT_BODY),
      })
      expect(unknown.status).toBe(404)
      const badBody = await app.request('/tool-policies/mcp__vynel__list_tasks', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...ALL_INHERIT_BODY, cardClass: 'sometimes' }),
      })
      expect(badBody.status).toBe(400)
    })
  })

  it('exposes NO tool-policies route to MCP (an agent must never edit its own gates)', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request('/openapi.json')
      const spec = (await res.json()) as {
        paths: Record<string, Record<string, { 'x-mcp'?: { exposed?: boolean } }>>
      }
      for (const [path, operations] of Object.entries(spec.paths)) {
        if (!path.startsWith('/tool-policies')) continue
        for (const operation of Object.values(operations)) {
          expect(operation['x-mcp']?.exposed).not.toBe(true)
        }
      }
    })
  })
})
