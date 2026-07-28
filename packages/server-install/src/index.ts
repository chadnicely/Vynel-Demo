// Public surface of `@vynel/server-install` — the Phase D provisioner leaf:
// turn SSH reach into a running remote engine (preflight → upload → systemd
// user service → sealed bearer → health). No MCP descriptor by design:
// provisioning is a UI/onboarding surface, never an agent tool.

export {
  startServerInstall,
  type StartServerInstallInput,
} from './provisioning/start-server-install.js'
export {
  runProvision,
  type ProvisionDeps,
  type PayloadArchive,
} from './provisioning/provision-server.js'
export {
  composeInstallPlan,
  composeEngineEnvFile,
  composeSystemdUnit,
  ENGINE_SERVICE_NAME,
  REMOTE_ENGINE_PORT,
  type RemoteInstallPlan,
} from './provisioning/install-plan.js'
export { PREFLIGHT_COMMAND, parsePreflightReport, type PreflightReport } from './provisioning/preflight.js'
export {
  openServerConnection,
  type OpenServerConnection,
  type ServerConnection,
  type ExecResult,
} from './connecting/server-connection.js'
export {
  startEngineTunnel,
  type EngineTunnel,
  type EngineTunnelInput,
} from './tunnel/engine-tunnel.js'
export {
  ClaudeAuthRelay,
  CLAUDE_LOGIN_COMMAND,
  CLAUDE_STATUS_COMMAND,
  type ClaudeAuthState,
  type ClaudeAuthPhase,
  type ClaudeAuthRelayDeps,
} from './auth/claude-auth-relay.js'
export {
  readRemoteClaudeAuthStatus,
  type RemoteClaudeAuthStatus,
} from './auth/read-claude-auth-status.js'
export {
  listServerInstallsForUser,
  findServerInstallById,
  findLatestInstalledServerInstall,
  hardDeleteServerInstall,
  type ServerInstall,
  type ServerInstallStatus,
  type ServerInstallStep,
  type ServerAuthKind,
} from './repositories/index.js'
export {
  SERVER_INSTALL_STARTED,
  SERVER_INSTALL_COMPLETED,
  SERVER_INSTALL_FAILED,
  type ServerInstallStartedPayload,
  type ServerInstallCompletedPayload,
  type ServerInstallFailedPayload,
} from './server-install-events.js'
export type { ServerCredentials, StructuralLogger } from './server-install-types.js'
