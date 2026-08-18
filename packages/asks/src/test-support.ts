// Shared test seeds for the asks core + route tests (the tasks/schedules
// test-support precedent; the production barrel keeps repositories internal).

import { randomUUID } from 'node:crypto'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import type { AskQuestion } from '@vynel/contracts/asks/ask-questions'
import type { NewAskRequest } from './repositories/index.js'

export { insertAskRequest, findAskRequestById } from './repositories/index.js'
export type { NewAskRequest } from './repositories/index.js'

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

export function makeQuestions(): AskQuestion[] {
  return [
    { id: 'audience', label: 'Who is this newsletter for?', type: 'text' },
    {
      id: 'tone',
      label: 'What tone should it have?',
      type: 'choice',
      options: ['Friendly', 'Professional', 'Playful'],
    },
    { id: 'include-photos', label: 'Include photos?', type: 'yes-no', required: false },
  ]
}

export function makeAskRequest(
  userId: string,
  workspaceId: string | null,
  overrides: Partial<NewAskRequest> = {},
): NewAskRequest {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId,
    sessionId: null,
    taskId: null,
    questionsJson: JSON.stringify(makeQuestions()),
    answersJson: null,
    status: 'pending',
    createdAt: now,
    resolvedAt: null,
    ...overrides,
  }
}
