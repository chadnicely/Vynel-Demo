// Registers the `vynel ssh <...>` subcommands on a commander program,
// mapping CLI args → the namespaced SDK's user-scoped `sshServers` methods
// and printing the (typed) result. `getClient` is injected so tests drive
// the commands against a stub client. Mirrors apps-commands.ts.
//
// DELIBERATELY no `add`: registering a server takes the password/private key,
// and a secret on a CLI flag is bad hygiene (it lands in shell history and
// process lists). Adding happens in the app's form — the credential's only
// door (docs/module-notes/ssh.md).

import type { Command } from 'commander'
import type { VynelClient } from '@vynel/sdk'
import { printResult } from './output.js'

export function registerSshCommands(program: Command, getClient: () => VynelClient): void {
  const ssh = program.command('ssh').description('List + test the registered SSH servers')

  ssh
    .command('list')
    .description("List the user's registered servers (never shows credentials)")
    .action(async () => {
      printResult(await getClient().sshServers.list())
    })

  ssh
    .command('test <serverId>')
    .description('Test the connection to a server (pins its host key on first use)')
    .action(async (serverId: string) => {
      printResult(await getClient().sshServers.testConnection(serverId))
    })

  ssh
    .command('remove <serverId>')
    .description('Remove a server (its sealed credential dies with it)')
    .action(async (serverId: string) => {
      // remove returns 204 (no body); confirm the id acted on.
      await getClient().sshServers.remove(serverId)
      printResult({ removed: serverId })
    })
}
