// Registers the `vynel skills <...>` subcommands on a commander program,
// mapping CLI args/flags → the namespaced SDK's `skills` methods and printing
// the (typed) result. `getClient` is injected so tests drive the commands
// against a stub client — no server, no process. Mirrors knowledge-commands.ts.

import { Option, type Command } from 'commander'
import type { VynelClient } from '@vynel/sdk'
import { printResult } from './output.js'

const SKILL_SCOPES = ['user', 'workspace'] as const

export function registerSkillsCommands(program: Command, getClient: () => VynelClient): void {
  const skills = program.command('skills').description('List + manage curated skills for a workspace')

  skills
    .command('list')
    .description("List the skills installed into the workspace (what it owns)")
    .requiredOption('-w, --workspace <id>', 'workspace id')
    // Without this the split would silently shorten `skills list`: the default
    // is now the workspace's own installs, so `--resolved` is how you still ask
    // what a session running there can actually reach (user ∪ workspace).
    .option('--resolved', 'include user-scope skills — everything available there')
    .action(async (opts: { workspace: string; resolved?: boolean }) => {
      const client = getClient()
      printResult(
        opts.resolved === true
          ? await client.skills.listInstalledResolved(opts.workspace)
          : await client.skills.listInstalled(opts.workspace),
      )
    })

  skills
    .command('available')
    .description('List skills available to install')
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .action(async (opts: { workspace: string }) => {
      printResult(await getClient().skills.listAvailable(opts.workspace))
    })

  skills
    .command('install <skillId>')
    .description('Install a skill into the workspace or the user (scope)')
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .addOption(
      new Option('-s, --scope <scope>', 'install scope').choices([...SKILL_SCOPES]).makeOptionMandatory(),
    )
    .action(async (skillId: string, opts: { workspace: string; scope: string }) => {
      printResult(
        await getClient().skills.install(opts.workspace, {
          skillId,
          // safe: `.choices` guarantees scope ∈ SKILL_SCOPES at runtime.
          scope: opts.scope as (typeof SKILL_SCOPES)[number],
        }),
      )
    })

  skills
    .command('uninstall <installedSkillId>')
    .description('Uninstall an installed skill (removes it from disk)')
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .action(async (installedSkillId: string, opts: { workspace: string }) => {
      // uninstall returns 204 (no body); confirm the id acted on.
      await getClient().skills.uninstall(opts.workspace, installedSkillId)
      printResult({ uninstalled: installedSkillId })
    })

  skills
    .command('synchronize')
    .description('Re-sync installed skills with the provider on disk')
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .action(async (opts: { workspace: string }) => {
      printResult(await getClient().skills.synchronize(opts.workspace))
    })
}
