// The dispatch-card enrichment: a send_message / send_task_* call whose output
// names a delegation job gains that job's outcome (the settled-history door);
// other tools, errored outputs, and pruned jobs pass through untouched. Real
// db, real jobs — never mock the DB.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  enqueueWorkspaceDelegation,
  enqueueSessionDelegation,
  enqueueReportDelivery,
  findDelegationJobById,
  resolveThreadIdOf,
} from '@vynel/orchestration'
import type { Database } from '@vynel/db'
import {
  attachDelegationToolOutcomes,
  extractDispatchResult,
} from './attach-delegation-tool-outcomes.js'

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

function seedTaskJob(db: Database, taskText: string): string {
  const now = new Date()
  const user = seedUser(db)
  const workspace = insertWorkspace(db, {
    id: randomUUID(),
    userId: user.id,
    name: 'Acme',
    path: 'C:/tmp/acme',
    kind: 'project',
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return enqueueWorkspaceDelegation(db, {
    userId: user.id,
    parentSessionId: 'root-1',
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    workspaceName: workspace.name,
    taskText,
  })
}

/** The persisted shape of an in-process MCP tool's result, wrapping the REAL
 *  wire body a dispatch route answers — each route names its destination
 *  DIFFERENTLY (routing/index.ts), and a fabricated uniform shape here once
 *  defended the wrong parse (increment-3 review; the sourceLabel lesson). */
function mcpOutput(routeBody: Record<string, unknown>): unknown {
  return { content: [{ type: 'text', text: JSON.stringify(routeBody) }] }
}

describe('attachDelegationToolOutcomes', () => {
  it('attaches the job outcome per REAL route shape and leaves other tools untouched', async () => {
    await withTestDatabase((db) => {
      const workspaceJobId = seedTaskJob(db, 'Summarize the pricing docs\nwith sources.')
      const sessionJobId = seedTaskJob(db, 'Compare the vendors.')
      const job = findDelegationJobById(db, workspaceJobId)!

      const enriched = attachDelegationToolOutcomes(db, {
        m1: [
          // send_task_to_workspace answers { status, jobId, workspaceName }.
          {
            toolName: 'mcp__vynel__send_task_to_workspace',
            toolOutput: mcpOutput({
              status: 'enqueued',
              jobId: workspaceJobId,
              workspaceName: 'Acme',
            }),
          },
          // send_task_to_session answers { status, jobId, sessionName }.
          {
            toolName: 'mcp__vynel__send_task_to_session',
            toolOutput: mcpOutput({
              status: 'enqueued',
              jobId: sessionJobId,
              sessionName: 'Research',
            }),
          },
          { toolName: 'Read', toolOutput: 'file contents' },
        ],
      })

      expect(enriched['m1']![0]).toMatchObject({
        delegation: {
          jobId: workspaceJobId,
          partialSessionId: job.partialSessionId,
          status: 'pending',
          deliveredTo: 'Acme',
          taskLabel: 'Summarize the pricing docs',
          reportedAt: null,
          completedAt: null,
        },
      })
      expect(enriched['m1']![1]).toMatchObject({
        delegation: { jobId: sessionJobId, deliveredTo: 'Research' },
      })
      expect(enriched['m1']![2]).not.toHaveProperty('delegation')
    })
  })

  it('leaves a dispatch call untouched on errored (prose) output or a pruned job', async () => {
    await withTestDatabase((db) => {
      const enriched = attachDelegationToolOutcomes(db, {
        m1: [
          // An errored dispatch persists prose, never the { jobId } JSON.
          { toolName: 'mcp__vynel__send_task_to_workspace', toolOutput: 'Error 404: not found' },
          // A parseable output whose job row is gone — no dead chip.
          // (send_message answers { status, jobId, deliveredTo, kind }.)
          {
            toolName: 'mcp__vynel__send_message',
            toolOutput: mcpOutput({
              status: 'enqueued',
              jobId: randomUUID(),
              deliveredTo: 'Acme',
              kind: 'task',
            }),
          },
        ],
      })
      expect(enriched['m1']![0]).not.toHaveProperty('delegation')
      expect(enriched['m1']![1]).not.toHaveProperty('delegation')
    })
  })

  // PIPELINE SCOPING (Chad, locked 2026-07-27): the enrichment carries the
  // DIRECT hop only — a chain that grew (the workspace spawned a session) must
  // NOT flatten deeper hops into the dispatching thread. The session's chip
  // lives inside the opened watch panel instead.
  it('carries the DIRECT hop only — a grown thread chain never rides along', async () => {
    await withTestDatabase((db) => {
      const workspaceJobId = seedTaskJob(db, 'Get the architecture of letterman.')
      const workspaceJob = findDelegationJobById(db, workspaceJobId)!
      enqueueSessionDelegation(db, {
        userId: workspaceJob.userId,
        parentSessionId: 'ws-root-sdk-1',
        targetPrimarySessionId: randomUUID(),
        runCwdPath: 'C:/tmp/acme',
        taskText: 'Produce a comprehensive overview.',
        threadId: resolveThreadIdOf(workspaceJob)!,
      })

      const enriched = attachDelegationToolOutcomes(db, {
        m1: [
          {
            toolName: 'mcp__vynel__send_task_to_workspace',
            toolOutput: mcpOutput({
              status: 'enqueued',
              jobId: workspaceJobId,
              workspaceName: 'Acme',
            }),
          },
        ],
      })

      expect(enriched['m1']![0]!.delegation).toMatchObject({
        jobId: workspaceJobId,
        deliveredTo: 'Acme',
      })
      expect(enriched['m1']![0]!.delegation).not.toHaveProperty('chainHops')
    })
  })

  it('a report-delivery dispatch carries NO task label — its taskText is the report body', async () => {
    await withTestDatabase((db) => {
      const user = seedUser(db)
      const deliveryJobId = enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: 'ws-root-sdk-1',
        reporterLabel: 'Mark · Acme',
        reportBody: 'Finding: every doc is current.',
        requester: { kind: 'global-root' },
      })

      const enriched = attachDelegationToolOutcomes(db, {
        m1: [
          {
            toolName: 'mcp__vynel__send_message',
            toolOutput: mcpOutput({
              status: 'enqueued',
              jobId: deliveryJobId,
              deliveredTo: 'Global',
              kind: 'report',
            }),
          },
        ],
      })
      expect(enriched['m1']![0]).toMatchObject({
        delegation: { jobId: deliveryJobId, deliveredTo: 'Global', taskLabel: null },
      })
    })
  })
})

describe('extractDispatchResult', () => {
  it('unwraps MCP content, bare arrays, and plain JSON strings; rejects prose', () => {
    const wire = JSON.stringify({ jobId: 'j1', deliveredTo: 'Acme' })
    const expected = { jobId: 'j1', deliveredTo: 'Acme' }

    expect(extractDispatchResult({ content: [{ type: 'text', text: wire }] })).toEqual(expected)
    expect(extractDispatchResult([{ type: 'text', text: wire }])).toEqual(expected)
    expect(extractDispatchResult(wire)).toEqual(expected)
    expect(extractDispatchResult('Delivered to Acme.')).toBeNull()
    expect(extractDispatchResult(null)).toBeNull()
    expect(extractDispatchResult({ content: 'not-an-array' })).toBeNull()
  })
})
