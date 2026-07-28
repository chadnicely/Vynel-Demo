// Public surface of `@vynel/ssh-servers` — the ssh leaf (registered remote
// servers Claude drives WITHOUT ever seeing a credential). SDK-free barrel;
// the descriptor lives on `./mcp`, the native keyring vault on `./keyring`
// (the asks/hub-account precedents).

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

// Sealing (pure) + the vault seam; the OS-keyring impl stays on ./keyring.
export { sealSecret, openSecret } from './sealing/seal-secret.js'
export {
  resolveMasterKey,
  createInMemoryMasterKeyVault,
  type MasterKeyVault,
} from './sealing/master-key.js'
export { createFileMasterKeyVault } from './sealing/file-master-key-vault.js'
