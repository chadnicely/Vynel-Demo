// Core op — publish a RUNTIME fact (`app.started` / `app.stopped` /
// `app.crashed`). Runtime facts change no row, so each event commits in its
// own small transaction; the api edge calls this after the supervisor acts
// (start/stop routes) or observes (the onExit callback).

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import {
  APP_CRASHED,
  APP_STARTED,
  APP_STOPPED,
  type AppCrashedPayload,
  type AppStartedPayload,
  type AppStoppedPayload,
} from '../apps-events.js'
import * as appsRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type { WorkspaceApp } from '../repositories/index.js'

export type AppRuntimeFact =
  | { kind: 'started' }
  | { kind: 'stopped' }
  | { kind: 'crashed'; exitCode: number | null }

// The supervisor onExit binding: a SELF-exit (never a requested stop) becomes
// `app.crashed` (non-zero) or `app.stopped` (clean zero — e.g. a build
// command finishing). Missing row (removed while running) drops quietly.
export function publishAppExitOutcome(
  db: Database,
  input: { appId: string; exitCode: number | null; crashed: boolean },
): void {
  const app = appsRepository.findAppById(db, input.appId)
  if (!app) return
  publishAppRuntimeEvent(
    db,
    app,
    input.crashed ? { kind: 'crashed', exitCode: input.exitCode } : { kind: 'stopped' },
  )
}

export function publishAppRuntimeEvent(
  db: Database,
  app: WorkspaceApp,
  fact: AppRuntimeFact,
): void {
  const now = new Date()
  const base = {
    appId: app.id,
    userId: app.userId,
    workspaceId: app.workspaceId,
    name: app.name,
  }
  const event: { type: string; payload: AppStartedPayload | AppStoppedPayload | AppCrashedPayload } =
    fact.kind === 'started'
      ? { type: APP_STARTED, payload: { ...base, startedAt: now.toISOString() } }
      : fact.kind === 'stopped'
        ? { type: APP_STOPPED, payload: { ...base, stoppedAt: now.toISOString() } }
        : {
            type: APP_CRASHED,
            payload: { ...base, exitCode: fact.exitCode, crashedAt: now.toISOString() },
          }

  withTransaction(db, (tx) => {
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: event.type,
      payload: event.payload,
      createdAt: now,
      processedAt: null,
    })
  })
}
