// `ssh_servers` table for the `ssh-servers` domain — one row per remote
// server the user registered. `userId` tenant boundary; `workspaceId`
// nullable, NULL = GLOBAL scope (the standard house model).
//
// `encryptedCredentials` is a SEALED AES-256-GCM blob (JSON {nonce,
// ciphertext, tag}, all base64) against the OS-keyring-held master key —
// NEVER returned by any route, NEVER logged, and there is NO read-credential
// surface anywhere (rotation = remove + re-add). Claude drives SSH through
// the run tool; the credential is opened only inside the exec path.
//
// `hostKeyFingerprint` is the TOFU pin: recorded on the first successful
// connect, compared on every one after — a changed host key fails the
// connection loudly instead of silently trusting a new machine.

import { table, id, text, timestamp, integer, index } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import { workspaces } from '@vynel/db/schema/workspaces'

export type SshAuthKind = 'password' | 'private-key'

export const sshServers = table(
  'ssh_servers',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: text().references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(), // plain language ("My web server"); unique per user, case-insensitive
    host: text().notNull(),
    port: integer().notNull(), // default 22 applied at the op
    username: text().notNull(),
    authKind: text().$type<SshAuthKind>().notNull(),
    encryptedCredentials: text().notNull(), // sealed blob — never returned, never logged
    hostKeyFingerprint: text(), // TOFU pin (sha256 base64); null until first connect
    lastConnectedAt: timestamp(),
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => ({
    userWorkspaceIdx: index('idx_ssh_servers_user_workspace').on(t.userId, t.workspaceId),
  }),
)

export type SshServer = typeof sshServers.$inferSelect
export type NewSshServer = typeof sshServers.$inferInsert
