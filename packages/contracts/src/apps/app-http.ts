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
  /** The app's env file, relative to its own folder (default '.env'). */
  envFileRelative: string
  port: number | null
  runtime: WorkspaceAppRuntime | null
  /** ISO-8601 */
  createdAt: string
  /** ISO-8601 */
  updatedAt: string
}

// ── The env editor (user-only surface; never an MCP tool) ─────────────

export interface AppEnvEntry {
  key: string
  value: string
}

export interface AppEnvResponse {
  envFileRelative: string
  /** false = the file does not exist yet (saving creates it). */
  exists: boolean
  entries: AppEnvEntry[]
}
