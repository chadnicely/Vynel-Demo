// Shared test seeds for the tasks core + route tests. Mirrors schedules'
// `test-support.ts` (seed helpers; the production barrel keeps repositories
// internal, so route/integration tests seed through here).

import { randomUUID } from 'node:crypto'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import type { NewSessionTodo, NewTask, NewTaskStep } from './repositories/index.js'

export { insertTask, insertSessionTodo, insertTaskStep } from './repositories/index.js'
export type { NewTask, NewSessionTodo, NewTaskStep } from './repositories/index.js'

export function seedUserWorkspace(db: Database): { userId: string; workspaceId: string } {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'Dana',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
  const workspace = insertWorkspace(db, {
    id: randomUUID(),
    userId: user.id,
    name: 'Bakery',
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return { userId: user.id, workspaceId: workspace.id }
}

export function makeSessionTodo(
  userId: string,
  sessionId: string,
  overrides: Partial<NewSessionTodo> = {},
): NewSessionTodo {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId: null,
    sessionId,
    title: 'Read the brief',
    status: 'open',
    orderIndex: 0,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function makeTask(
  userId: string,
  workspaceId: string | null,
  overrides: Partial<NewTask> = {},
): NewTask {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId,
    title: 'Draft the newsletter',
    detail: null,
    status: 'open',
    source: 'assistant',
    sessionId: null,
    planId: null,
    assignedSessionId: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function makeTaskStep(
  userId: string,
  taskId: string,
  overrides: Partial<NewTaskStep> = {},
): NewTaskStep {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId: null,
    taskId,
    planId: null,
    sessionId: null,
    title: 'Read the brief',
    status: 'open',
    orderIndex: 0,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}
