// Response serializer for `workspace-apps` HTTP routes — the durable row +
// the supervisor's live snapshot merged into one response. Date columns emit
// as ISO strings.

import type { AppRunSnapshot, WorkspaceApp } from '@vynel/apps'
import type { WorkspaceAppResponse } from '@vynel/contracts/apps/app-http'

export function serializeAppForResponse(
  app: WorkspaceApp,
  snapshot: AppRunSnapshot | null,
): WorkspaceAppResponse {
  return {
    id: app.id,
    userId: app.userId,
    workspaceId: app.workspaceId,
    name: app.name,
    command: app.command,
    cwdRelative: app.cwdRelative,
    envFileRelative: app.envFileRelative,
    port: app.port,
    runtime: snapshot
      ? {
          status: snapshot.status,
          pid: snapshot.pid,
          startedAt: snapshot.startedAt.toISOString(),
          exitCode: snapshot.exitCode,
        }
      : null,
    createdAt: app.createdAt.toISOString(),
    updatedAt: app.updatedAt.toISOString(),
  }
}
