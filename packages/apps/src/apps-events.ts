// Outbox event type constants + payload interfaces for the `apps` domain.
// Two families:
//   - REGISTRATION facts (DB state): `app.registered` / `app.updated` /
//     `app.removed` — co-committed with the row change in ONE transaction.
//   - RUNTIME facts (supervisor state, no row change): `app.started` /
//     `app.stopped` / `app.crashed` — published by the api edge when the
//     supervisor acts/observes (publishAppRuntimeEvent), each in its own
//     transaction. Publish-from-day-one; the relay is live (2026-07-17).
//
// Payloads are loose-ref FACTS only; the command string stays out of runtime
// payloads (the row has it — an activity feed needs the fact, not the shell).

export const APP_REGISTERED = 'app.registered' as const
export const APP_UPDATED = 'app.updated' as const
export const APP_REMOVED = 'app.removed' as const
export const APP_STARTED = 'app.started' as const
export const APP_STOPPED = 'app.stopped' as const
export const APP_CRASHED = 'app.crashed' as const

type AppEventBase = {
  appId: string
  userId: string
  workspaceId: string
  name: string
}

export type AppRegisteredPayload = AppEventBase & { registeredAt: string }
export type AppUpdatedPayload = AppEventBase & { updatedAt: string }
export type AppRemovedPayload = AppEventBase & { removedAt: string }
export type AppStartedPayload = AppEventBase & { startedAt: string }
export type AppStoppedPayload = AppEventBase & { stoppedAt: string }
export type AppCrashedPayload = AppEventBase & { exitCode: number | null; crashedAt: string }
