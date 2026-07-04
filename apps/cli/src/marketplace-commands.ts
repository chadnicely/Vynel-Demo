// Registers the `vynel marketplace <...>` subcommands on a commander program,
// mapping CLI args/flags → the namespaced SDK's `marketplace` methods and
// printing the (typed) result. `getClient` is injected so tests drive the
// commands against a stub client — no server, no process. Mirrors
// knowledge-commands.ts. The marketplace surface is read-only (list + get).

import type { Command } from 'commander'
import type { VynelClient } from '@vynel/sdk'
import { printResult } from './output.js'

export function registerMarketplaceCommands(program: Command, getClient: () => VynelClient): void {
  const marketplace = program
    .command('marketplace')
    .description('Browse the skill marketplace for the workspace')

  marketplace
    .command('list')
    .description('List marketplace items')
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .action(async (opts: { workspace: string }) => {
      printResult(await getClient().marketplace.listItems(opts.workspace))
    })

  marketplace
    .command('get <itemId>')
    .description('Get one marketplace item by id')
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .action(async (itemId: string, opts: { workspace: string }) => {
      printResult(await getClient().marketplace.getItem(opts.workspace, itemId))
    })
}
