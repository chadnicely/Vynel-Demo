// The `vynel` CLI program — direction ① (a CLI over the namespaced SDK).
// `buildProgram` is side-effect-free and takes an injected client factory
// so it's unit-testable against a stub; the executable entry (with the
// real client + argv parsing) lives in `bin.ts`.

import { Command } from 'commander'
import type { VynelClient } from '@vynel/sdk'
import { registerKnowledgeCommands } from './knowledge-commands.js'

export function buildProgram(getClient: () => VynelClient): Command {
  const program = new Command()
  program
    .name('vynel')
    .description('Vynel CLI — knowledge search + inspection over the local API.')
    .version('0.0.0')
  registerKnowledgeCommands(program, getClient)
  return program
}
