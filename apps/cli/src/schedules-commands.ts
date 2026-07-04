// Registers the `vynel schedules <...>` subcommands on a commander program,
// mapping CLI args/flags → the namespaced SDK's `schedules` methods and printing
// the (typed) result. `getClient` is injected so tests drive the commands
// against a stub client — no server, no process. Mirrors knowledge-commands.ts.
//
// `mine` reads every schedule the user owns (both global + workspace scopes)
// via the user-scoped surface; the rest are workspace-scoped reads + the safe
// lifecycle mutations (enable/disable/delete/fire-now).

import { InvalidArgumentError, type Command } from 'commander'
import type { VynelClient } from '@vynel/sdk'
import { printResult } from './output.js'

// commander yields option values as strings; coerce the numeric ones.
function toInt(value: string): number {
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) throw new InvalidArgumentError(`expected an integer, got "${value}".`)
  return parsed
}

export function registerSchedulesCommands(program: Command, getClient: () => VynelClient): void {
  const schedules = program.command('schedules').description('List + manage scheduled tasks')

  schedules
    .command('list')
    .description('List schedules for the workspace')
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .action(async (opts: { workspace: string }) => {
      printResult(await getClient().schedules.list(opts.workspace))
    })

  schedules
    .command('mine')
    .description("List all of the user's schedules (both global + workspace scopes)")
    .action(async () => {
      printResult(await getClient().schedulesUser.list())
    })

  schedules
    .command('templates')
    .description('List the available schedule templates')
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .action(async (opts: { workspace: string }) => {
      printResult(await getClient().schedules.listTemplates(opts.workspace))
    })

  schedules
    .command('runs <scheduleId>')
    .description("List a schedule's run history (most recent first)")
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .option('-l, --limit <n>', 'max results', toInt)
    .action(async (scheduleId: string, opts: { workspace: string; limit?: number }) => {
      printResult(
        await getClient().schedules.listRuns(
          opts.workspace,
          scheduleId,
          opts.limit !== undefined ? { limit: opts.limit } : undefined,
        ),
      )
    })

  schedules
    .command('enable <scheduleId>')
    .description('Enable a schedule')
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .action(async (scheduleId: string, opts: { workspace: string }) => {
      printResult(await getClient().schedules.enable(opts.workspace, scheduleId))
    })

  schedules
    .command('disable <scheduleId>')
    .description('Disable a schedule')
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .action(async (scheduleId: string, opts: { workspace: string }) => {
      printResult(await getClient().schedules.disable(opts.workspace, scheduleId))
    })

  schedules
    .command('delete <scheduleId>')
    .description('Delete a schedule')
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .action(async (scheduleId: string, opts: { workspace: string }) => {
      // delete returns 204 (no body); confirm the id acted on.
      await getClient().schedules.delete(opts.workspace, scheduleId)
      printResult({ deleted: scheduleId })
    })

  schedules
    .command('fire-now <scheduleId>')
    .description('Fire a schedule immediately (manual run)')
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .action(async (scheduleId: string, opts: { workspace: string }) => {
      printResult(await getClient().schedules.fireNow(opts.workspace, scheduleId))
    })
}
