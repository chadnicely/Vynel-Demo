// Registers the `vynel tasks <...>` subcommands on a commander program,
// mapping CLI args/flags → the namespaced SDK's user-scoped `tasksUser`
// methods and printing the (typed) result. `getClient` is injected so tests
// drive the commands against a stub client — no server, no process. Mirrors
// schedules-commands.ts.
//
// The CLI is a USER surface, so it drives `tasksUser.*` throughout (create
// stamps source='user'); the workspace-scoped `tasks.*` twin is the agent's
// door and stamps 'assistant' — the CLI never calls it.

import { InvalidArgumentError, type Command } from 'commander'
import type { VynelClient } from '@vynel/sdk'
import { printResult } from './output.js'

const TASK_STATUSES = ['open', 'in-progress', 'done'] as const
type TaskStatusFlag = (typeof TASK_STATUSES)[number]

function toTaskStatus(value: string): TaskStatusFlag {
  if ((TASK_STATUSES as readonly string[]).includes(value)) return value as TaskStatusFlag
  throw new InvalidArgumentError(`expected one of ${TASK_STATUSES.join(' / ')}, got "${value}".`)
}

export function registerTasksCommands(program: Command, getClient: () => VynelClient): void {
  const tasks = program.command('tasks').description('List + manage the task list')

  tasks
    .command('list')
    .description("List all the user's tasks (both global + workspace scopes)")
    .option('-s, --status <status>', 'filter: open / in-progress / done', toTaskStatus)
    .action(async (opts: { status?: TaskStatusFlag }) => {
      // Branch instead of passing `undefined` — keeps the no-filter call a real
      // zero-arg invocation (the stub-recording tests assert the exact arity).
      const result =
        opts.status !== undefined
          ? await getClient().tasksUser.list({ status: opts.status })
          : await getClient().tasksUser.list()
      printResult(result)
    })

  tasks
    .command('add <title>')
    .description('Add a task (global by default; -w scopes it to a workspace)')
    .option('-w, --workspace <id>', 'workspace id (omit for a global task)')
    .option('-d, --detail <text>', 'longer description')
    .action(async (title: string, opts: { workspace?: string; detail?: string }) => {
      const detail = opts.detail !== undefined ? { detail: opts.detail } : {}
      printResult(
        await getClient().tasksUser.create(
          opts.workspace !== undefined
            ? { scope: 'workspace', workspaceId: opts.workspace, title, ...detail }
            : { scope: 'global', title, ...detail },
        ),
      )
    })

  tasks
    .command('done <taskId>')
    .description('Mark a task done')
    .action(async (taskId: string) => {
      printResult(await getClient().tasksUser.update(taskId, { status: 'done' }))
    })

  tasks
    .command('reopen <taskId>')
    .description('Reopen a completed task')
    .action(async (taskId: string) => {
      printResult(await getClient().tasksUser.update(taskId, { status: 'open' }))
    })

  tasks
    .command('delete <taskId>')
    .description('Delete a task')
    .action(async (taskId: string) => {
      // delete returns 204 (no body); confirm the id acted on.
      await getClient().tasksUser.delete(taskId)
      printResult({ deleted: taskId })
    })
}
