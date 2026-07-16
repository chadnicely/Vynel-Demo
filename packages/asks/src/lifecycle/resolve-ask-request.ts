// Core op — resolve a pending ask (owner-scoped): the user answered or
// dismissed. Answers are validated TYPE-AWARE against the stored question set
// (a choice answer must be one of its options, required questions must be
// answered). Only a pending ask can resolve — answering an already-resolved
// one is a Conflict, not a silent overwrite. Patch + `ask.resolved` co-commit
// in ONE transaction. sync.
//
// The caller (the answer/dismiss route) resolves the in-memory waiter AFTER
// this commits — DB first, then unblock the turn, so the awaiting tool can
// never observe answers the DB doesn't hold.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { ConflictError, NotFoundError, ValidationError } from '@vynel/errors'
import {
  AskQuestionsSchema,
  validateAskAnswers,
  type AskAnswers,
} from '@vynel/contracts/asks/ask-questions'
import * as asksRepository from '../repositories/index.js'
import { ASK_RESOLVED, type AskResolvedPayload } from '../asks-events.js'
import type { Database } from '@vynel/db'
import type { AskRequest } from '../repositories/index.js'
import type { StructuralLogger } from '../asks-types.js'

export type ResolveAskResolution =
  | { kind: 'answered'; answers: AskAnswers }
  | { kind: 'dismissed' }

export interface ResolveAskRequestInput {
  askId: string
  userId: string
  resolution: ResolveAskResolution
}

export function resolveAskRequest(
  db: Database,
  input: ResolveAskRequestInput,
  deps: { logger?: StructuralLogger } = {},
): AskRequest & { validatedAnswers: AskAnswers | null } {
  const ask = asksRepository.findAskRequestById(db, input.askId)
  // Not-found and not-owned are deliberately the same 404 (no existence probe).
  if (!ask || ask.userId !== input.userId) {
    throw new NotFoundError('ask', input.askId)
  }
  if (ask.status !== 'pending') {
    throw new ConflictError(`This ask was already ${ask.status}.`)
  }

  let validatedAnswers: AskAnswers | null = null
  if (input.resolution.kind === 'answered') {
    // The stored questions were schema-validated at insert; re-parse defensively
    // (never trust a JSON column on read).
    const questions = AskQuestionsSchema.parse(JSON.parse(ask.questionsJson))
    const validation = validateAskAnswers(questions, input.resolution.answers)
    if (!validation.ok) {
      throw new ValidationError(`The answers don't fit the form: ${validation.problems.join('; ')}.`)
    }
    validatedAnswers = validation.answers
  }

  const now = new Date()
  const status = input.resolution.kind === 'answered' ? 'answered' : 'dismissed'
  const updated = withTransaction(db, (tx) => {
    const row = asksRepository.updateAskRequest(tx, ask.id, {
      status,
      answersJson: validatedAnswers !== null ? JSON.stringify(validatedAnswers) : null,
      resolvedAt: now,
    })
    const payload: AskResolvedPayload = {
      askId: row.id,
      userId: row.userId,
      workspaceId: row.workspaceId,
      status,
      resolvedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: ASK_RESOLVED,
      payload,
      createdAt: now,
      processedAt: null,
    })
    return row
  })

  deps.logger?.info({ askId: updated.id, status }, 'ask resolved')
  return { ...updated, validatedAnswers }
}
