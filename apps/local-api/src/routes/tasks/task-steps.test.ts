// Integration tests for the TASK-STEPS surface — the agent's whole-list
// replace (`set_task_steps` on the workspace door), the list rollup, the
// pickup stamp, and the user door's read/tick/delete. Full HTTP stack:
// route -> validator -> scoped bundle -> core op -> repo -> SQLite (real, via
// withTestDatabase). No mocks.
//
// TENANT-ISOLATION ordering invariant: the Phase-1 resolver returns the FIRST
// user row (`findSingleLocalUser` = limit(1)), so the "attacker" (the resolved
// local user) is `insertUser`'d BEFORE the victim's rows.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertChatSession, type NewChatSession } from '@vynel/chat/repositories'
import { insertTask, insertTaskStep, makeTask, makeTaskStep } from '@vynel/tasks/test-support'
import { createApp } from '../../app.js'
import { TURN_SESSION_HEADER } from '../../sessions/turn-session-header.js'
import type { Database } from '@vynel/db'
import type { TaskResponse } from '@vynel/contracts/tasks/task-http'
import type { TaskStepResponse } from '@vynel/contracts/tasks/task-step-http'

const silentLogger = pino({ level: 'silent' })

function makeUser() {
  const now = new Date()
  return {
    id: randomUUID(),
    displayName: 'Dana',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

function seedWorkspace(db: Database, userId: string) {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name: 'Bakery',
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

function makeSession(userId: string, workspaceId: string | null): NewChatSession {
  const now = new Date()
  return {
    id: `session-${randomUUID()}`,
    userId,
    workspaceId,
    providerId: 'claude',
    title: 'A conversation',
    isArchived: false,
    deletedAt: null,
    totalMessageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    startedAt: now,
    lastMessageAt: now,
    updatedAt: now,
  }
}

function setSteps(
  app: ReturnType<typeof createApp>,
  workspaceId: string,
  taskId: string,
  payload: unknown,
  headers: Record<string, string> = {},
) {
  return app.request(`/workspaces/${workspaceId}/tasks/${taskId}/steps`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  })
}

describe('PUT /workspaces/:workspaceId/tasks/:taskId/steps — the agent door', () => {
  it('replaces the list with the full linkage: scope from the task, session from the header, plan from the body', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)
      const session = insertChatSession(db, makeSession(user.id, workspace.id))
      const task = insertTask(db, makeTask(user.id, workspace.id))

      const res = await setSteps(
        app,
        workspace.id,
        task.id,
        {
          steps: [
            { title: 'Read the brief', status: 'done' },
            { title: 'Draft the copy', status: 'in-progress' },
          ],
          planId: 'plan-1',
        },
        { [TURN_SESSION_HEADER]: session.id },
      )
      expect(res.status).toBe(200)
      const steps = (await res.json()) as TaskStepResponse[]
      expect(steps.map((step) => step.title)).toEqual(['Read the brief', 'Draft the copy'])
      expect(steps.map((step) => step.orderIndex)).toEqual([0, 1])
      expect(steps.every((step) => step.taskId === task.id)).toBe(true)
      expect(steps.every((step) => step.workspaceId === workspace.id)).toBe(true)
      expect(steps.every((step) => step.sessionId === session.id)).toBe(true)
      expect(steps.every((step) => step.planId === 'plan-1')).toBe(true)
    })
  })

  it('works WITHOUT an ambient session (a background turn) — sessionId stays null', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)
      const task = insertTask(db, makeTask(user.id, workspace.id))

      const res = await setSteps(app, workspace.id, task.id, {
        steps: [{ title: 'Step', status: 'open' }],
      })
      expect(res.status).toBe(200)
      const steps = (await res.json()) as TaskStepResponse[]
      expect(steps[0]!.sessionId).toBeNull()
      expect(steps[0]!.planId).toBeNull()
    })
  })

  it('treats a garbage or foreign ambient session as ABSENT — never a durable ref, never an error', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser()) // resolved local user (first row)
      const workspace = seedWorkspace(db, user.id)
      const task = insertTask(db, makeTask(user.id, workspace.id))
      const victim = insertUser(db, makeUser())
      const victimSession = insertChatSession(db, makeSession(victim.id, null))

      for (const header of ['no-such-session', victimSession.id]) {
        const res = await setSteps(
          app,
          workspace.id,
          task.id,
          { steps: [{ title: 'Step', status: 'open' }] },
          { [TURN_SESSION_HEADER]: header },
        )
        expect(res.status).toBe(200)
        const steps = (await res.json()) as TaskStepResponse[]
        expect(steps[0]!.sessionId).toBeNull()
      }

      // Same wall on the pickup stamp.
      const picked = (await (
        await app.request(`/workspaces/${workspace.id}/tasks/${task.id}`, {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            [TURN_SESSION_HEADER]: victimSession.id,
          },
          body: JSON.stringify({ status: 'in-progress' }),
        })
      ).json()) as TaskResponse
      expect(picked.assignedSessionId).toBeNull()
    })
  })

  it("404s another user's task (identical to unknown)", async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const attacker = insertUser(db, makeUser()) // resolved local user (first row)
      const attackerWorkspace = seedWorkspace(db, attacker.id)
      const victim = insertUser(db, makeUser())
      const victimTask = insertTask(db, makeTask(victim.id, null))

      const foreign = await setSteps(app, attackerWorkspace.id, victimTask.id, {
        steps: [{ title: 'Step', status: 'open' }],
      })
      expect(foreign.status).toBe(404)

      const unknown = await setSteps(app, attackerWorkspace.id, 'no-such-task', {
        steps: [{ title: 'Step', status: 'open' }],
      })
      expect(unknown.status).toBe(404)
    })
  })
})

describe('the step rollup on list responses', () => {
  it('both list doors carry stepsDone/stepsTotal (0/0 when a task has no steps)', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)
      const withSteps = insertTask(db, makeTask(user.id, workspace.id))
      const bare = insertTask(db, makeTask(user.id, workspace.id))
      insertTaskStep(db, makeTaskStep(user.id, withSteps.id, { status: 'done' }))
      insertTaskStep(db, makeTaskStep(user.id, withSteps.id, { orderIndex: 1 }))

      for (const path of [`/workspaces/${workspace.id}/tasks`, '/tasks']) {
        const rows = (await (await app.request(path)).json()) as TaskResponse[]
        const counted = rows.find((row) => row.id === withSteps.id)
        expect(counted?.stepsTotal).toBe(2)
        expect(counted?.stepsDone).toBe(1)
        const empty = rows.find((row) => row.id === bare.id)
        expect(empty?.stepsTotal).toBe(0)
        expect(empty?.stepsDone).toBe(0)
      }
    })
  })
})

describe('the pickup stamp on the agent PATCH', () => {
  it('moving to in-progress with an ambient session stamps assignedSessionId; the user door never stamps', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)
      const session = insertChatSession(db, makeSession(user.id, workspace.id))
      const task = insertTask(db, makeTask(user.id, workspace.id))

      const picked = (await (
        await app.request(`/workspaces/${workspace.id}/tasks/${task.id}`, {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            [TURN_SESSION_HEADER]: session.id,
          },
          body: JSON.stringify({ status: 'in-progress' }),
        })
      ).json()) as TaskResponse
      expect(picked.assignedSessionId).toBe(session.id)

      // The USER ticking a status through the panel door is not a pickup —
      // the assignment survives untouched.
      const userTicked = (await (
        await app.request(`/tasks/${task.id}`, {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            [TURN_SESSION_HEADER]: 'session-someone-else',
          },
          body: JSON.stringify({ status: 'in-progress' }),
        })
      ).json()) as TaskResponse
      expect(userTicked.assignedSessionId).toBe(session.id)
    })
  })

  it('a header-less agent PATCH to in-progress leaves the assignment untouched', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)
      const task = insertTask(
        db,
        makeTask(user.id, workspace.id, { assignedSessionId: 'session-earlier' }),
      )

      const res = (await (
        await app.request(`/workspaces/${workspace.id}/tasks/${task.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'in-progress' }),
        })
      ).json()) as TaskResponse
      expect(res.assignedSessionId).toBe('session-earlier')
    })
  })
})

describe('the user door — GET steps / PATCH step / DELETE step', () => {
  it('lists one task in order, ticks a step (stamping completedAt), and removes it', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const task = insertTask(db, makeTask(user.id, null))
      const step = insertTaskStep(db, makeTaskStep(user.id, task.id, { title: 'A' }))
      insertTaskStep(db, makeTaskStep(user.id, task.id, { title: 'B', orderIndex: 1 }))

      const listed = (await (
        await app.request(`/tasks/${task.id}/steps`)
      ).json()) as TaskStepResponse[]
      expect(listed.map((row) => row.title)).toEqual(['A', 'B'])

      const patched = (await (
        await app.request(`/tasks/steps/${step.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'done' }),
        })
      ).json()) as TaskStepResponse
      expect(patched.status).toBe('done')
      expect(patched.completedAt).not.toBeNull()

      expect((await app.request(`/tasks/steps/${step.id}`, { method: 'DELETE' })).status).toBe(204)
      const rest = (await (
        await app.request(`/tasks/${task.id}/steps`)
      ).json()) as TaskStepResponse[]
      expect(rest.map((row) => row.title)).toEqual(['B'])
    })
  })

  it("404s a PATCH/DELETE on another user's step", async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      insertUser(db, makeUser()) // resolved local user (first row)
      const victim = insertUser(db, makeUser())
      const victimTask = insertTask(db, makeTask(victim.id, null))
      const step = insertTaskStep(db, makeTaskStep(victim.id, victimTask.id))

      const patched = await app.request(`/tasks/steps/${step.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      })
      expect(patched.status).toBe(404)
      expect((await app.request(`/tasks/steps/${step.id}`, { method: 'DELETE' })).status).toBe(404)
    })
  })
})
