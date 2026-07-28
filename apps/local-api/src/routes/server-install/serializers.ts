// Response serializer for `server-install` routes. Date columns emit as ISO
// strings. THE SECRET-STRIPPING BOUNDARY: `encryptedCredentials` AND
// `sealedAuthToken` are deliberately absent from the returned shape — neither
// sealed blob ever leaves the daemon (the ssh-servers discipline). Single
// source of truth for the shape is `@vynel/contracts/server-install/
// server-install-http`.

import type { ServerInstall } from '@vynel/server-install'
import type { ServerInstallResponse } from '@vynel/contracts/server-install/server-install-http'

export function serializeServerInstallForResponse(install: ServerInstall): ServerInstallResponse {
  return {
    id: install.id,
    userId: install.userId,
    host: install.host,
    port: install.port,
    username: install.username,
    authKind: install.authKind,
    hostKeyFingerprint: install.hostKeyFingerprint,
    status: install.status,
    step: install.step,
    errorMessage: install.errorMessage,
    installedVersion: install.installedVersion,
    lastHealthyAt: install.lastHealthyAt ? install.lastHealthyAt.toISOString() : null,
    createdAt: install.createdAt.toISOString(),
    updatedAt: install.updatedAt.toISOString(),
  }
}
