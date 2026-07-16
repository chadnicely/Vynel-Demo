// Core op — register a runnable app on a workspace (Claude adding what it
// needs, or the user via the dialog — no provenance column by design, module
// notes). Insert + `app.registered` co-commit in ONE transaction. sync.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { ConflictError, ValidationError } from '@vynel/errors'
import * as appsRepository from '../repositories/index.js'
import { APP_REGISTERED, type AppRegisteredPayload } from '../apps-events.js'
import type { Database } from '@vynel/db'
import type { WorkspaceApp } from '../repositories/index.js'
import type { StructuralLogger } from '../apps-types.js'

export const APP_NAME_MAX_LENGTH = 60
export const APP_COMMAND_MAX_LENGTH = 500

export interface RegisterAppInput {
  userId: string
  workspaceId: string
  name: string
  command: string
  cwdRelative?: string
  port?: number
}

// Shared field validation (register + update). The RESOLVED containment check
// (against the real workspace path) lives in the supervisor at spawn; this is
// the shape gate — no absolute paths, no `..` segments, no newlines in the
// command.
export function validateAppFields(input: {
  name?: string
  command?: string
  cwdRelative?: string
  port?: number | null
}): { name?: string; command?: string; cwdRelative?: string } {
  const out: { name?: string; command?: string; cwdRelative?: string } = {}
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (name.length === 0) throw new ValidationError('An app needs a name.')
    if (name.length > APP_NAME_MAX_LENGTH) {
      throw new ValidationError(`App names are capped at ${APP_NAME_MAX_LENGTH} characters.`)
    }
    out.name = name
  }
  if (input.command !== undefined) {
    const command = input.command.trim()
    if (command.length === 0) throw new ValidationError('An app needs a command to run.')
    if (command.length > APP_COMMAND_MAX_LENGTH || /[\r\n]/.test(command)) {
      throw new ValidationError('The run command must be a single line under 500 characters.')
    }
    out.command = command
  }
  if (input.cwdRelative !== undefined) {
    const cwdRelative = input.cwdRelative.trim().replace(/\\/g, '/')
    if (/^([a-zA-Z]:|\/|\\)/.test(cwdRelative) || cwdRelative.split('/').includes('..')) {
      throw new ValidationError('The app folder must be inside the workspace.')
    }
    out.cwdRelative = cwdRelative
  }
  if (input.port !== undefined && input.port !== null) {
    if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
      throw new ValidationError('The port must be a number between 1 and 65535.')
    }
  }
  return out
}

export function registerApp(
  db: Database,
  input: RegisterAppInput,
  deps: { logger?: StructuralLogger } = {},
): WorkspaceApp {
  const fields = validateAppFields({
    name: input.name,
    command: input.command,
    cwdRelative: input.cwdRelative ?? '',
    port: input.port ?? null,
  })

  if (appsRepository.findAppByName(db, { workspaceId: input.workspaceId, name: fields.name! })) {
    throw new ConflictError(`This workspace already has an app named "${fields.name}".`)
  }

  const now = new Date()
  const app = withTransaction(db, (tx) => {
    const inserted = appsRepository.insertApp(tx, {
      id: randomUUID(),
      userId: input.userId,
      workspaceId: input.workspaceId,
      name: fields.name!,
      command: fields.command!,
      cwdRelative: fields.cwdRelative ?? '',
      port: input.port ?? null,
      createdAt: now,
      updatedAt: now,
    })
    const payload: AppRegisteredPayload = {
      appId: inserted.id,
      userId: inserted.userId,
      workspaceId: inserted.workspaceId,
      name: inserted.name,
      registeredAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: APP_REGISTERED,
      payload,
      createdAt: now,
      processedAt: null,
    })
    return inserted
  })

  deps.logger?.info({ appId: app.id, name: app.name }, 'app registered')
  return app
}
