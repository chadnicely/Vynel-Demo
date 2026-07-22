// Registers the `vynel journal <...>` subcommands on a commander program,
// mapping CLI args/flags → the namespaced SDK's user-scoped `journalUser`
// methods and printing the (typed) result. `getClient` is injected so tests
// drive the commands against a stub client — no server, no process. Mirrors
// tasks-commands.ts.
//
// The CLI is a USER surface, so it drives `journalUser.*` throughout (create
// stamps source='user'). Edit/delete exist ONLY here + the panel — the
// agent's door is append + read only by design.

import type { Command } from 'commander'
import type { VynelClient } from '@vynel/sdk'
import { printResult } from './output.js'
import { localDayKey, toDayKey } from './day-flag.js'

export function registerJournalCommands(program: Command, getClient: () => VynelClient): void {
  const journal = program.command('journal').description('Read + write the daily work journal')

  journal
    .command('list')
    .description("Read the user's journal, newest first (both scopes)")
    .option('--date <date>', 'read one exact day (YYYY-MM-DD)', toDayKey)
    .option('--from <date>', 'range start, inclusive (YYYY-MM-DD)', toDayKey)
    .option('--to <date>', 'range end, inclusive (YYYY-MM-DD)', toDayKey)
    .action(async (opts: { date?: string; from?: string; to?: string }) => {
      // Branch instead of passing `undefined` — keeps the no-filter call a real
      // zero-arg invocation (the stub-recording tests assert the exact arity).
      const query = {
        ...(opts.date !== undefined ? { entryDate: opts.date } : {}),
        ...(opts.from !== undefined ? { from: opts.from } : {}),
        ...(opts.to !== undefined ? { to: opts.to } : {}),
      }
      const result =
        Object.keys(query).length > 0
          ? await getClient().journalUser.list(query)
          : await getClient().journalUser.list()
      printResult(result)
    })

  journal
    .command('add <content>')
    .description('Append a journal entry (today by default; global unless -w scopes it)')
    .option('--date <date>', 'the day the entry belongs to (YYYY-MM-DD; default today)', toDayKey)
    .option('-w, --workspace <id>', 'workspace id (omit for a global entry)')
    .action(async (content: string, opts: { date?: string; workspace?: string }) => {
      const entryDate = opts.date ?? localDayKey()
      printResult(
        await getClient().journalUser.create(
          opts.workspace !== undefined
            ? { scope: 'workspace', workspaceId: opts.workspace, entryDate, content }
            : { scope: 'global', entryDate, content },
        ),
      )
    })

  journal
    .command('delete <entryId>')
    .description('Delete a journal entry')
    .action(async (entryId: string) => {
      // delete returns 204 (no body); confirm the id acted on.
      await getClient().journalUser.delete(entryId)
      printResult({ deleted: entryId })
    })
}
