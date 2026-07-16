// HTTP response shape for the `apps` domain. Single source of truth: the
// local-api serializer types its return as `WorkspaceAppResponse`; the web
// app casts SDK responses to it (the tasks/asks precedent).
//
// The row is durable; `runtime` is the supervisor's live view merged in by
// the route — null when the app has not run in this daemon's lifetime.

export type AppRuntimeStatus = 'running' | 'exited' | 'crashed'

export interface WorkspaceAppRuntime {
  status: AppRuntimeStatus
  pid: number | null
  /** ISO-8601 */
  startedAt: string
  exitCode: number | null
}

export interface WorkspaceAppResponse {
  id: string
  userId: string
  workspaceId: string
  name: string
  command: string
  cwdRelative: string
  port: number | null
  runtime: WorkspaceAppRuntime | null
  /** ISO-8601 */
  createdAt: string
  /** ISO-8601 */
  updatedAt: string
}
