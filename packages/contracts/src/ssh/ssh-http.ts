// HTTP response shape for the `ssh-servers` domain. Single source of truth
// for the serialized response: `apps/local-api` types
// `serializeSshServerForResponse`'s return as `SshServerResponse`;
// `apps/local-web` casts SDK responses to it (the tasks/apps precedent).
//
// Union types re-declared locally — `@vynel/contracts` has no `@vynel/db` dep
// (kept in sync with `packages/ssh-servers/src/schema/ssh-servers.ts`).
//
// DELIBERATELY absent: `encryptedCredentials`. The sealed blob never leaves
// the leaf — no route, SDK, or UI shape carries it (module notes: there is no
// read-credential surface anywhere, by construction).

export type SshAuthKind = 'password' | 'private-key'

export interface SshServerResponse {
  id: string
  userId: string
  // Nullable to match the schema (NULL = GLOBAL scope — a user-level server
  // usable from any workspace).
  workspaceId: string | null
  name: string
  host: string
  port: number
  username: string
  authKind: SshAuthKind
  /** TOFU pin (sha256 base64); null until the first successful connect. */
  hostKeyFingerprint: string | null
  /** ISO-8601 or null */
  lastConnectedAt: string | null
  /** ISO-8601 */
  createdAt: string
  /** ISO-8601 */
  updatedAt: string
}
