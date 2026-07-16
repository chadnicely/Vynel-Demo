// Response serializer for `ssh-servers` HTTP routes. Date columns emit as
// ISO strings. THE SECRET-STRIPPING BOUNDARY: `encryptedCredentials` is
// deliberately absent from the returned shape — the sealed blob never leaves
// the leaf (module notes: no read-credential surface anywhere). Single source
// of truth for the response shape is `@vynel/contracts/ssh/ssh-http` (the
// tasks precedent).

import type { SshServer } from '@vynel/ssh-servers'
import type { SshServerResponse } from '@vynel/contracts/ssh/ssh-http'

export function serializeSshServerForResponse(server: SshServer): SshServerResponse {
  return {
    id: server.id,
    userId: server.userId,
    workspaceId: server.workspaceId,
    name: server.name,
    host: server.host,
    port: server.port,
    username: server.username,
    authKind: server.authKind,
    hostKeyFingerprint: server.hostKeyFingerprint,
    lastConnectedAt: server.lastConnectedAt ? server.lastConnectedAt.toISOString() : null,
    createdAt: server.createdAt.toISOString(),
    updatedAt: server.updatedAt.toISOString(),
  }
}
