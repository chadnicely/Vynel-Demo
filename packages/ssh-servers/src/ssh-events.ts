// Outbox event type constants + payload interfaces for the `ssh-servers`
// domain. Registration facts co-commit with the row change; the command fact
// commits in its own transaction (runtime, no row change — the apps
// precedent). Payloads are loose-ref FACTS: the plain-language description
// rides (readable history), the RAW COMMAND and credentials never do.

export const SSH_SERVER_ADDED = 'ssh.server-added' as const
export const SSH_SERVER_REMOVED = 'ssh.server-removed' as const
export const SSH_COMMAND_EXECUTED = 'ssh.command-executed' as const

type SshEventBase = {
  serverId: string
  userId: string
  workspaceId: string | null // null = GLOBAL scope
  name: string
}

export type SshServerAddedPayload = SshEventBase & { host: string; addedAt: string }
export type SshServerRemovedPayload = SshEventBase & { removedAt: string }
export type SshCommandExecutedPayload = SshEventBase & {
  description: string // Claude's plain-language intent — never the raw shell
  exitCode: number | null
  executedAt: string
}
