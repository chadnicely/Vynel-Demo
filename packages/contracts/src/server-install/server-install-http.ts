// HTTP response shape for the `server-install` domain (Phase D remote
// engines). Single source of truth for the serialized response: `apps/local-api`
// types `serializeServerInstallForResponse`'s return as `ServerInstallResponse`;
// the UI casts SDK responses to it (the ssh/tasks precedent).
//
// Union types re-declared locally — `@vynel/contracts` has no `@vynel/db` dep
// (kept in sync with `packages/server-install/src/schema/server-installs.ts`).
//
// DELIBERATELY absent: `encryptedCredentials` and `sealedAuthToken`. Neither
// sealed blob ever leaves the daemon — no route, SDK, or UI shape carries
// them (the ssh-servers no-read-credential-surface discipline).

export type ServerInstallStatus = 'provisioning' | 'installed' | 'failed'
export type ServerInstallStep = 'connect' | 'preflight' | 'upload' | 'install' | 'start' | 'health'
export type ServerAuthKind = 'password' | 'private-key'

export interface ServerInstallResponse {
  id: string
  userId: string
  host: string
  port: number
  username: string
  authKind: ServerAuthKind
  hostKeyFingerprint: string | null
  status: ServerInstallStatus
  step: ServerInstallStep | null
  errorMessage: string | null
  installedVersion: string | null
  lastHealthyAt: string | null // ISO-8601 or null
  createdAt: string
  updatedAt: string
}
