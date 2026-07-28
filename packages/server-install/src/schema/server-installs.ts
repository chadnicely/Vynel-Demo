// `server_installs` table for the `server-install` domain — one row per
// remote-engine install a user provisioned (Phase D: "run Vynel's engine on
// my server"). Machine-level, so no workspaceId — the engine serves every
// workspace.
//
// Deliberately does NOT reference `ssh_servers` (no cross-leaf FK): an engine
// install owns its own sealed credential copy — removing a registered ssh
// server must never strand the engine's tunnel.
//
// `encryptedCredentials` and `sealedAuthToken` are AES-256-GCM blobs against
// the machine master key (@vynel/sealing) — never returned, never logged.
// The auth token is the remote daemon's bearer (D1's VYNEL_AUTH_TOKEN); the
// D3 tunnel opens it to inject the Authorization header.
//
// `hostKeyFingerprint` is the TOFU pin (sha256 base64), recorded on the first
// successful connect and enforced on every one after.

import { table, id, text, timestamp, integer } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'

export type ServerInstallStatus = 'provisioning' | 'installed' | 'failed'
export type ServerInstallStep = 'connect' | 'preflight' | 'upload' | 'install' | 'start' | 'health'
export type ServerAuthKind = 'password' | 'private-key'

export const serverInstalls = table('server_installs', {
  id: id().primaryKey(),
  userId: id().references(() => users.id, { onDelete: 'cascade' }),
  host: text().notNull(),
  port: integer().notNull(), // default 22 applied at the op
  username: text().notNull(),
  authKind: text().$type<ServerAuthKind>().notNull(),
  encryptedCredentials: text().notNull(), // sealed blob — never returned, never logged
  sealedAuthToken: text().notNull(), // the remote daemon's bearer, sealed
  hostKeyFingerprint: text(), // TOFU pin; null until first connect
  status: text().$type<ServerInstallStatus>().notNull(),
  step: text().$type<ServerInstallStep>(), // the step in flight (or the one that failed)
  errorMessage: text(), // actionable, user-facing; set only when status = failed
  installedVersion: text(), // what /health reported after provisioning
  lastHealthyAt: timestamp(),
  createdAt: timestamp().notNull(),
  updatedAt: timestamp().notNull(),
})

export type ServerInstall = typeof serverInstalls.$inferSelect
export type NewServerInstall = typeof serverInstalls.$inferInsert
