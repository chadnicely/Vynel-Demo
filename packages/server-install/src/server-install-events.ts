// Outbox event constants + payload types for the server-install domain.
// Payloads carry ids and step names — never credentials, tokens, or command
// text.

export const SERVER_INSTALL_STARTED = 'server-install.started'
export const SERVER_INSTALL_COMPLETED = 'server-install.completed'
export const SERVER_INSTALL_FAILED = 'server-install.failed'

type ServerInstallEventBase = { installId: string; userId: string; host: string }

export type ServerInstallStartedPayload = ServerInstallEventBase & { startedAt: string }

export type ServerInstallCompletedPayload = ServerInstallEventBase & {
  installedVersion: string | null
  completedAt: string
}

export type ServerInstallFailedPayload = ServerInstallEventBase & {
  step: string
  failedAt: string
}
