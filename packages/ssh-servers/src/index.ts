// Public surface of `@vynel/ssh-servers` — the ssh leaf (registered remote
// servers Claude drives WITHOUT ever seeing a credential). SDK-free barrel;
// the descriptor lives on `./mcp`. Sealing crypto + the master-key vaults
// moved to the SHARED `@vynel/sealing` when server-install became their
// second consumer.

export type { StructuralLogger, SshCredentials, SshCommandResult } from './ssh-types.js'
export type { SshServer, SshAuthKind } from './repositories/index.js'

export {
  SSH_SERVER_ADDED,
  SSH_SERVER_REMOVED,
  SSH_COMMAND_EXECUTED,
  type SshServerAddedPayload,
  type SshServerRemovedPayload,
  type SshCommandExecutedPayload,
} from './ssh-events.js'

export { addSshServer, type AddSshServerInput } from './lifecycle/add-ssh-server.js'
export { removeSshServer } from './lifecycle/remove-ssh-server.js'
export { listSshServers } from './queries/list-ssh-servers.js'
export {
  runServerCommand,
  type RunServerCommandInput,
} from './connecting/run-server-command.js'
export { SshHostKeyMismatchError } from './connecting/execute-ssh-command.js'
