// The `vynel` CLI program — direction ① (a CLI over the namespaced SDK).
// `buildProgram` is side-effect-free and takes an injected client factory
// so it's unit-testable against a stub; the executable entry (with the
// real client + argv parsing) lives in `bin.ts`.

import { Command } from 'commander'
import type { VynelClient } from '@vynel/sdk'
import { registerKnowledgeCommands } from './knowledge-commands.js'
import { registerSkillsCommands } from './skills-commands.js'
import { registerChannelsCommands } from './channels-commands.js'
import { registerSchedulesCommands } from './schedules-commands.js'
import { registerMarketplaceCommands } from './marketplace-commands.js'
import { registerTasksCommands } from './tasks-commands.js'
import { registerPlansCommands } from './plans-commands.js'
import { registerJournalCommands } from './journal-commands.js'
import { registerAppsCommands } from './apps-commands.js'
import { registerSshCommands } from './ssh-commands.js'

export function buildProgram(getClient: () => VynelClient): Command {
  const program = new Command()
  program
    .name('vynel')
    .description(
      'Vynel CLI — knowledge, skills, channels, schedules, tasks, plans, journal, apps, ssh + marketplace over the local API.',
    )
    .version('0.0.0')
  registerKnowledgeCommands(program, getClient)
  registerSkillsCommands(program, getClient)
  registerChannelsCommands(program, getClient)
  registerSchedulesCommands(program, getClient)
  registerMarketplaceCommands(program, getClient)
  registerTasksCommands(program, getClient)
  registerPlansCommands(program, getClient)
  registerJournalCommands(program, getClient)
  registerAppsCommands(program, getClient)
  registerSshCommands(program, getClient)
  return program
}
