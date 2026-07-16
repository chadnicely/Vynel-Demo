// Registers the `vynel apps <...>` subcommands on a commander program,
// mapping CLI args/flags → the namespaced SDK's `workspaceApps` methods and
// printing the (typed) result. `getClient` is injected so tests drive the
// commands against a stub client. Mirrors tasks-commands.ts. Apps are
// workspace-scoped, so every subcommand requires `-w`.

import { InvalidArgumentError, type Command } from 'commander'
import type { VynelClient } from '@vynel/sdk'
import { printResult } from './output.js'

function toInt(value: string): number {
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) throw new InvalidArgumentError(`expected an integer, got "${value}".`)
  return parsed
}

export function registerAppsCommands(program: Command, getClient: () => VynelClient): void {
  const apps = program.command('apps').description('List + run the workspace apps')

  apps
    .command('list')
    .description("List the workspace's apps with live run status")
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .action(async (opts: { workspace: string }) => {
      printResult(await getClient().workspaceApps.list(opts.workspace))
    })

  apps
    .command('add <name>')
    .description('Register a runnable app on the workspace')
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .requiredOption('-c, --command <command>', 'the command that starts it')
    .option('-d, --dir <folder>', 'folder inside the workspace (default: the root)')
    .option('-p, --port <port>', 'the port it serves on', toInt)
    .action(
      async (
        name: string,
        opts: { workspace: string; command: string; dir?: string; port?: number },
      ) => {
        printResult(
          await getClient().workspaceApps.add(opts.workspace, {
            name,
            command: opts.command,
            ...(opts.dir !== undefined ? { cwdRelative: opts.dir } : {}),
            ...(opts.port !== undefined ? { port: opts.port } : {}),
          }),
        )
      },
    )

  apps
    .command('start <appId>')
    .description('Start an app')
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .action(async (appId: string, opts: { workspace: string }) => {
      printResult(await getClient().workspaceApps.start(opts.workspace, appId))
    })

  apps
    .command('stop <appId>')
    .description('Stop a running app')
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .action(async (appId: string, opts: { workspace: string }) => {
      printResult(await getClient().workspaceApps.stop(opts.workspace, appId))
    })

  apps
    .command('logs <appId>')
    .description("Read an app's recent output")
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .option('-t, --tail <lines>', 'max lines (default 200)', toInt)
    .action(async (appId: string, opts: { workspace: string; tail?: number }) => {
      const result =
        opts.tail !== undefined
          ? await getClient().workspaceApps.logs(opts.workspace, appId, { tail: opts.tail })
          : await getClient().workspaceApps.logs(opts.workspace, appId)
      printResult(result)
    })

  apps
    .command('remove <appId>')
    .description('Remove an app (stops it first if running)')
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .action(async (appId: string, opts: { workspace: string }) => {
      // remove returns 204 (no body); confirm the id acted on.
      await getClient().workspaceApps.remove(opts.workspace, appId)
      printResult({ removed: appId })
    })
}
