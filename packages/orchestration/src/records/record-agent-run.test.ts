// Tests for the agent-run lifecycle emitters. Real SQLite; verifies each
// writes the right outbox event with its payload. (The outbox_events table
// has no FKs, so no user/workspace fixtures are needed.)

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { recordAgentRunStarted, recordAgentRunCompleted } from './record-agent-run.js'
import { AGENT_RUN_STARTED, AGENT_RUN_COMPLETED } from '../orchestration-events.js'

describe('recordAgentRunStarted', () => {
  it('writes an agent.run-started outbox event with the run payload', async () => {
    await withTestDatabase(async (db) => {
      const runId = randomUUID()
      await recordAgentRunStarted(db, {
        runId,
        userId: 'user-1',
        workspaceId: 'ws-1',
        agentSlugs: ['researcher', 'document-generator'],
        startedAt: '2026-06-21T00:00:00.000Z',
      })

      const events = listOutboxEventsByType(db, AGENT_RUN_STARTED)
      expect(events).toHaveLength(1)
      const payload = events[0]!.payload as Record<string, unknown>
      expect(payload.runId).toBe(runId)
      expect(payload.agentSlugs).toEqual(['researcher', 'document-generator'])
    })
  })
})

describe('recordAgentRunCompleted', () => {
  it('writes an agent.run-completed outbox event paired by runId', async () => {
    await withTestDatabase(async (db) => {
      const runId = randomUUID()
      await recordAgentRunCompleted(db, {
        runId,
        userId: 'user-1',
        workspaceId: 'ws-1',
        completedAt: '2026-06-21T00:01:00.000Z',
      })

      const events = listOutboxEventsByType(db, AGENT_RUN_COMPLETED)
      expect(events).toHaveLength(1)
      expect((events[0]!.payload as Record<string, unknown>).runId).toBe(runId)
    })
  })
})
