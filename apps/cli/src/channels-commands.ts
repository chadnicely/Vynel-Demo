// Registers the `vynel channels <...>` subcommands on a commander program,
// mapping CLI args/flags → the namespaced SDK's `channels` methods and printing
// the (typed) result. `getClient` is injected so tests drive the commands
// against a stub client — no server, no process. Mirrors knowledge-commands.ts.
//
// Read-focused + the safe mutations (enable/disable/disconnect). `connect`
// (carries a bot token) is intentionally omitted from the CLI. `get` + `mine`
// read a single/all channel(s) across both scopes via the user-scoped surface —
// the only get-one method the SDK exposes (there is no workspace get-one route).

import type { Command } from 'commander'
import type { VynelClient } from '@vynel/sdk'
import { printResult } from './output.js'

export function registerChannelsCommands(program: Command, getClient: () => VynelClient): void {
  const channels = program.command('channels').description('List + inspect connected messaging channels')

  channels
    .command('list')
    .description('List connected channels for the workspace')
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .action(async (opts: { workspace: string }) => {
      printResult(await getClient().channels.list(opts.workspace))
    })

  channels
    .command('mine')
    .description("List all of the user's channels (both global + workspace scopes)")
    .action(async () => {
      printResult(await getClient().channelsUser.list())
    })

  channels
    .command('get <channelId>')
    .description('Get one channel by id (user-scoped; credentials excluded)')
    .action(async (channelId: string) => {
      printResult(await getClient().channelsUser.get(channelId))
    })

  channels
    .command('allowed-senders <channelId>')
    .description('List the allowed senders for a channel')
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .action(async (channelId: string, opts: { workspace: string }) => {
      printResult(await getClient().channels.listAllowedSenders(opts.workspace, channelId))
    })

  channels
    .command('enable <channelId>')
    .description('Enable a connected channel')
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .action(async (channelId: string, opts: { workspace: string }) => {
      printResult(await getClient().channels.enable(opts.workspace, channelId))
    })

  channels
    .command('disable <channelId>')
    .description('Disable a connected channel')
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .action(async (channelId: string, opts: { workspace: string }) => {
      printResult(await getClient().channels.disable(opts.workspace, channelId))
    })

  channels
    .command('disconnect <channelId>')
    .description('Disconnect a channel (hard-delete + cascade)')
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .action(async (channelId: string, opts: { workspace: string }) => {
      // disconnect returns 204 (no body); confirm the id acted on.
      await getClient().channels.disconnect(opts.workspace, channelId)
      printResult({ disconnected: channelId })
    })
}
