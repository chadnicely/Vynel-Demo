// Core op — record a pending ask (the durable half of the blocking bridge).
// Validates the question set against the contracts schema (defense at the
// boundary even though the SDK tool layer already validated), inserts the
// pending row + co-commits `ask.created` in ONE transaction. sync.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { ValidationError } from '@vynel/errors'
import { AskQuestionsSchema, type AskQuestion } from '@vynel/contracts/asks/ask-questions'
import * as asksRepository from '../repositories/index.js'
import { ASK_CREATED, type AskCreatedPayload } from '../asks-events.js'
import type { Database } from '@vynel/db'
import type { AskRequest } from '../repositories/index.js'
import type { StructuralLogger } from '../asks-types.js'

export interface CreateAskRequestInput {
  userId: string
  workspaceId: string | null // null = a global-root turn's ask
  questions: AskQuestion[]
  sessionId?: string
  taskId?: string // loose ref — the task this ask clears (NO FK)
}

export function createAskRequest(
  db: Database,
  input: CreateAskRequestInput,
  deps: { logger?: StructuralLogger } = {},
): AskRequest {
  const parsed = AskQuestionsSchema.safeParse(input.questions)
  if (!parsed.success) {
    const detail = parsed.error.issues[0]?.message ?? 'invalid questions'
    throw new ValidationError(`The ask form is invalid: ${detail}.`)
  }

  const now = new Date()
  const ask = withTransaction(db, (tx) => {
    const inserted = asksRepository.insertAskRequest(tx, {
      id: randomUUID(),
      userId: input.userId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId ?? null,
      taskId: input.taskId ?? null,
      questionsJson: JSON.stringify(parsed.data),
      answersJson: null,
      status: 'pending',
      createdAt: now,
      resolvedAt: null,
    })
    const payload: AskCreatedPayload = {
      askId: inserted.id,
      userId: inserted.userId,
      workspaceId: inserted.workspaceId,
      questionCount: parsed.data.length,
      firstQuestionLabel: parsed.data[0]!.label,
      createdAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: ASK_CREATED,
      payload,
      createdAt: now,
      processedAt: null,
    })
    return inserted
  })

  deps.logger?.info({ askId: ask.id, questionCount: parsed.data.length }, 'ask created')
  return ask
}
