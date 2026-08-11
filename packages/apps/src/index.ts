// Public surface of `@vynel/apps` — the apps leaf (register + run + monitor a
// workspace's runnable apps). Consumers reach the package only through this
// barrel; schema, repositories and the concern folders are internal.

export type { StructuralLogger, AppRunStatus, AppRunSnapshot } from './apps-types.js'
export type { WorkspaceApp } from './repositories/index.js'

export {
  APP_REGISTERED,
  APP_UPDATED,
  APP_REMOVED,
  APP_STARTED,
  APP_STOPPED,
  APP_CRASHED,
  type AppRegisteredPayload,
  type AppUpdatedPayload,
  type AppRemovedPayload,
  type AppStartedPayload,
  type AppStoppedPayload,
  type AppCrashedPayload,
} from './apps-events.js'

// CRUD + read ops (sync) + the runtime-fact publisher.
export {
  registerApp,
  type RegisterAppInput,
  APP_NAME_MAX_LENGTH,
  APP_COMMAND_MAX_LENGTH,
} from './lifecycle/register-app.js'
export { updateApp, type UpdateAppInput } from './lifecycle/update-app.js'
export { removeApp } from './lifecycle/remove-app.js'
export { listApps } from './queries/list-apps.js'
export { getAppOrThrow } from './queries/get-app.js'
export {
  publishAppRuntimeEvent,
  publishAppExitOutcome,
  type AppRuntimeFact,
} from './lifecycle/publish-app-runtime-event.js'

// The process supervisor (one per api process, DI'd like the ask registry).
export {
  AppProcessSupervisor,
  resolveContainedCwd,
  type StartAppProcessInput,
} from './running/app-process-supervisor.js'

// The app's env file (parse + line-preserving rewrite, containment-checked).
export {
  readAppEnvFile,
  writeAppEnvFile,
  type AppEnvEntry,
  type AppEnvFileRef,
} from './env/app-env-file.js'
