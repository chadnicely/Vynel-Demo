// Registers the `vynel plans <...>` subcommands on a commander program,
// mapping CLI args/flags → the namespaced SDK's user-scoped `plansUser`
// methods and printing the (typed) result. `getClient` is injected so tests
// drive the commands against a stub client — no server, no process. Mirrors
// tasks-commands.ts.
//
// The CLI is a USER surface, so it drives `plansUser.*` throughout (create
// stamps source='user'); the workspace-scoped `plans.*` twin is the agent's
// door and stamps 'assistant' — the CLI never calls it.

import { InvalidArgumentError, type Command } from 'commander'
import type { VynelClient } from '@vynel/sdk'
import { printResult } from './output.js'
import { localDayKey, toDayKey } from './day-flag.js'

const PLAN_STATUSES = ['open', 'in-progress', 'done'] as const
type PlanStatusFlag = (typeof PLAN_STATUSES)[number]

function toPlanStatus(value: string): PlanStatusFlag {
  if ((PLAN_STATUSES as readonly string[]).includes(value)) return value as PlanStatusFlag
  throw new InvalidArgumentError(`expected one of ${PLAN_STATUSES.join(' / ')}, got "${value}".`)
}

export function registerPlansCommands(program: Command, getClient: () => VynelClient): void {
  const plans = program.command('plans').description('List + manage the date-wise plans')

  plans
    .command('list')
    .description("List all the user's plans (both global + workspace scopes)")
    .option('-s, --status <status>', 'filter: open / in-progress / done', toPlanStatus)
    .option('--date <date>', 'filter to one day (YYYY-MM-DD)', toDayKey)
    .action(async (opts: { status?: PlanStatusFlag; date?: string }) => {
      // Branch instead of passing `undefined` — keeps the no-filter call a real
      // zero-arg invocation (the stub-recording tests assert the exact arity).
      const query = {
        ...(opts.status !== undefined ? { status: opts.status } : {}),
        ...(opts.date !== undefined ? { planDate: opts.date } : {}),
      }
      const result =
        Object.keys(query).length > 0
          ? await getClient().plansUser.list(query)
          : await getClient().plansUser.list()
      printResult(result)
    })

  plans
    .command('add <title>')
    .description('Plan a day (today by default; global unless -w scopes it)')
    .option('--date <date>', 'the day the plan is for (YYYY-MM-DD; default today)', toDayKey)
    .option('-w, --workspace <id>', 'workspace id (omit for a global plan)')
    .option('-d, --detail <text>', 'longer description')
    .action(
      async (title: string, opts: { date?: string; workspace?: string; detail?: string }) => {
        const planDate = opts.date ?? localDayKey()
        const detail = opts.detail !== undefined ? { detail: opts.detail } : {}
        printResult(
          await getClient().plansUser.create(
            opts.workspace !== undefined
              ? { scope: 'workspace', workspaceId: opts.workspace, title, planDate, ...detail }
              : { scope: 'global', title, planDate, ...detail },
          ),
        )
      },
    )

  plans
    .command('done <planId>')
    .description('Mark a plan done')
    .action(async (planId: string) => {
      printResult(await getClient().plansUser.update(planId, { status: 'done' }))
    })

  plans
    .command('reopen <planId>')
    .description('Reopen a completed plan')
    .action(async (planId: string) => {
      printResult(await getClient().plansUser.update(planId, { status: 'open' }))
    })

  plans
    .command('move <planId> <date>')
    .description('Move a plan to another day (YYYY-MM-DD)')
    .action(async (planId: string, date: string) => {
      printResult(await getClient().plansUser.update(planId, { planDate: toDayKey(date) }))
    })

  plans
    .command('delete <planId>')
    .description('Delete a plan')
    .action(async (planId: string) => {
      // delete returns 204 (no body); confirm the id acted on.
      await getClient().plansUser.delete(planId)
      printResult({ deleted: planId })
    })
}
