// Core op — patch a registered app (owner-scoped): name, command, folder,
// port. Patch + `app.updated` co-commit in ONE transaction. sync. A running
// app keeps its old process — the new command applies on the next start (the
// route says so in its description).

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { ConflictError, NotFoundError } from '@vynel/errors'
import * as appsRepository from '../repositories/index.js'
import { validateAppFields } from './register-app.js'
import { APP_UPDATED, type AppUpdatedPayload } from '../apps-events.js'
import type { Database } from '@vynel/db'
import type { NewWorkspaceApp, WorkspaceApp } from '../repositories/index.js'
import type { StructuralLogger } from '../apps-types.js'

export interface UpdateAppInput {
  appId: string
  userId: string
  name?: string
  command?: string
  cwdRelative?: string
  envFileRelative?: string
  port?: number | null
}

export function updateApp(
  db: Database,
  input: UpdateAppInput,
  deps: { logger?: StructuralLogger } = {},
): WorkspaceApp {
  const app = appsRepository.findAppById(db, input.appId)
  // Not-found and not-owned are deliberately the same 404 (no existence probe).
  if (!app || app.userId !== input.userId) {
    throw new NotFoundError('app', input.appId)
  }

  const fields = validateAppFields(input)
  if (fields.name !== undefined && fields.name.toLowerCase() !== app.name.toLowerCase()) {
    const clash = appsRepository.findAppByName(db, {
      workspaceId: app.workspaceId,
      name: fields.name,
    })
    if (clash && clash.id !== app.id) {
      throw new ConflictError(`This workspace already has an app named "${fields.name}".`)
    }
  }

  const now = new Date()
  const patch: Partial<NewWorkspaceApp> = { updatedAt: now, ...fields }
  if (input.port !== undefined) patch.port = input.port

  const updated = withTransaction(db, (tx) => {
    const row = appsRepository.updateApp(tx, app.id, patch)
    const payload: AppUpdatedPayload = {
      appId: row.id,
      userId: row.userId,
      workspaceId: row.workspaceId,
      name: row.name,
      updatedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: APP_UPDATED,
      payload,
      createdAt: now,
      processedAt: null,
    })
    return row
  })

  deps.logger?.info({ appId: updated.id }, 'app updated')
  return updated
}
