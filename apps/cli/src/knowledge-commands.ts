// Registers the `vynel knowledge <...>` subcommands on a commander
// program, mapping CLI args/flags → the namespaced SDK's `knowledge`
// methods and printing the (typed) result. `getClient` is injected so
// tests drive the commands against a stub client — no server, no process.

import { InvalidArgumentError, Option, type Command } from 'commander'
import type { VynelClient } from '@vynel/sdk'
import { printResult } from './output.js'

const SEARCH_MODES = ['fts', 'semantic', 'hybrid'] as const
const DOCUMENT_KINDS = [
  'markdown',
  'plain-text',
  'pdf',
  'docx',
  'html',
  'csv',
  'json',
  'unsupported',
] as const

// commander yields option values as strings; coerce the numeric ones.
function toInt(value: string): number {
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) throw new InvalidArgumentError(`expected an integer, got "${value}".`)
  return parsed
}

export function registerKnowledgeCommands(program: Command, getClient: () => VynelClient): void {
  const knowledge = program.command('knowledge').description('Search + inspect the knowledge index')

  knowledge
    .command('search <query>')
    .description('Search knowledge chunks (fts / semantic / hybrid)')
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .addOption(new Option('-m, --mode <mode>', 'search mode').choices([...SEARCH_MODES]))
    .option('-l, --limit <n>', 'max results', toInt)
    .action(async (query: string, opts: { workspace: string; mode?: string; limit?: number }) => {
      printResult(
        await getClient().knowledge.search(opts.workspace, {
          query,
          // safe: `.choices` guarantees mode ∈ SEARCH_MODES at runtime.
          ...(opts.mode !== undefined ? { mode: opts.mode as (typeof SEARCH_MODES)[number] } : {}),
          ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
        }),
      )
    })

  knowledge
    .command('list')
    .description('List indexed documents')
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .addOption(new Option('-k, --kind <kind>', 'filter by document kind').choices([...DOCUMENT_KINDS]))
    .option('-l, --limit <n>', 'max results', toInt)
    .action(async (opts: { workspace: string; kind?: string; limit?: number }) => {
      printResult(
        await getClient().knowledge.listDocuments(opts.workspace, {
          // safe: `.choices` guarantees kind ∈ DOCUMENT_KINDS at runtime.
          ...(opts.kind !== undefined
            ? { documentKind: opts.kind as (typeof DOCUMENT_KINDS)[number] }
            : {}),
          ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
        }),
      )
    })

  knowledge
    .command('get <documentId>')
    .description('Get one document + its chunks')
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .action(async (documentId: string, opts: { workspace: string }) => {
      printResult(await getClient().knowledge.getDocument(opts.workspace, documentId))
    })

  knowledge
    .command('status')
    .description('Show indexer status for the workspace')
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .action(async (opts: { workspace: string }) => {
      printResult(await getClient().knowledge.getStatus(opts.workspace))
    })

  knowledge
    .command('reindex')
    .description('Force-reindex every document in the workspace')
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .action(async (opts: { workspace: string }) => {
      printResult(await getClient().knowledge.reindex(opts.workspace))
    })

  knowledge
    .command('add-source <path>')
    .alias('add-directory')
    .description('Register a directory or single file to index (indexes + watches it)')
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .option('-g, --global', 'register as a global (user-level) source, not workspace-scoped')
    .action(async (path: string, opts: { workspace: string; global?: boolean }) => {
      printResult(
        await getClient().knowledge.addSource(opts.workspace, {
          absolutePath: path,
          scope: opts.global ? 'global' : 'workspace',
        }),
      )
    })

  knowledge
    .command('sources')
    .description("List registered knowledge sources (the workspace's + the user's global)")
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .action(async (opts: { workspace: string }) => {
      printResult(await getClient().knowledge.listSources(opts.workspace))
    })

  knowledge
    .command('remove-source <sourceId>')
    .description('Remove a registered knowledge source (stops watching + purges its docs)')
    .requiredOption('-w, --workspace <id>', 'workspace id')
    .action(async (sourceId: string, opts: { workspace: string }) => {
      printResult(await getClient().knowledge.removeSource(opts.workspace, sourceId))
    })
}
