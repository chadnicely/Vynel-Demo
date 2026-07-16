// Core op — remove a registered app (owner-scoped). Hard delete (a row is a
// pointer at the user's own code, not irrecoverable content). The ROUTE stops
// a running process first — the supervisor is the api edge's, not the leaf's.
// Delete + `app.removed` co-commit in ONE transaction.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import * as appsRepository from '../repositories/index.js'
import { APP_REMOVED, type AppRemovedPayload } from '../apps-events.js'
import type { Database } from '@vynel/db'
import type { WorkspaceApp } from '../repositories/index.js'
import type { StructuralLogger } from '../apps-types.js'

export function removeApp(
  db: Database,
  input: { appId: string; userId: string },
  deps: { logger?: StructuralLogger } = {},
): WorkspaceApp {
  const app = appsRepository.findAppById(db, input.appId)
  // Not-found and not-owned are deliberately the same 404 (no existence probe).
  if (!app || app.userId !== input.userId) {
    throw new NotFoundError('app', input.appId)
  }

  const now = new Date()
  withTransaction(db, (tx) => {
    appsRepository.hardDeleteApp(tx, app.id)
    const payload: AppRemovedPayload = {
      appId: app.id,
      userId: app.userId,
      workspaceId: app.workspaceId,
      name: app.name,
      removedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: APP_REMOVED,
      payload,
      createdAt: now,
      processedAt: null,
    })
  })

  deps.logger?.info({ appId: app.id }, 'app removed')
  return app
}
