// The VERIFIED notebook shelf — team-curated books shipped from the repo
// directory `packages/instructions/notebooks/` (settled fork #2: no
// marketplace distribution yet; the team drops a markdown file in and it
// ships). Books are on-demand REFERENCE material — current best-practice
// playbooks the model opens when a task calls for one — never injected
// wholesale into prompts, never editable in the UI, never DB rows.
//
// Loaded lazily on first use and cached for the process lifetime (the
// VERIFIED_SKILL_CATALOG precedent, adapted to real .md files per Chad's
// "prepare a directory where we can add them"). A malformed file is a LOUD
// error naming the file — fail fast at first read, never a silently missing
// book.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type VerifiedNotebook = {
  /** Kebab-case, unique across the shelf — the `read_playbook` handle. */
  id: string
  title: string
  /** One sentence for the `list_playbooks` shelf view. */
  oneLiner: string
  /** The book's markdown body (frontmatter stripped). */
  body: string
}

const here = dirname(fileURLToPath(import.meta.url))
// src/notebooks/ (or dist/notebooks/ when compiled) → packages/instructions/notebooks/
const DEFAULT_NOTEBOOKS_DIR = resolve(here, '../../notebooks')

const KEBAB_CASE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/

// The frontmatter contract (documented for the team in notebooks/README.md):
// the file opens with `---`, carries `id:` / `title:` / `oneLiner:` lines,
// and closes with `---`. Parsed by hand — three known string keys don't
// justify a YAML dependency.
export function parseVerifiedNotebook(fileName: string, content: string): VerifiedNotebook {
  const fail = (reason: string): never => {
    throw new Error(
      `Verified notebook "${fileName}" is malformed: ${reason}. ` +
        'Fix the file per packages/instructions/notebooks/README.md (frontmatter with id, title, oneLiner).',
    )
  }

  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return fail('missing the opening/closing `---` frontmatter block')
  const frontmatter = match[1]!
  const body = match[2]!

  const fields = new Map<string, string>()
  for (const line of frontmatter.split(/\r?\n/)) {
    if (line.trim() === '') continue
    const separatorIndex = line.indexOf(':')
    if (separatorIndex === -1) return fail(`frontmatter line "${line}" is not a \`key: value\` pair`)
    fields.set(line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim())
  }

  const id = fields.get('id') ?? fail('frontmatter is missing `id`')
  const title = fields.get('title') ?? fail('frontmatter is missing `title`')
  const oneLiner = fields.get('oneLiner') ?? fail('frontmatter is missing `oneLiner`')
  if (!KEBAB_CASE_ID.test(id)) return fail(`id "${id}" must be kebab-case (lowercase words joined by hyphens)`)
  if (title.length === 0) return fail('`title` must not be empty')
  if (oneLiner.length === 0) return fail('`oneLiner` must not be empty')
  if (body.trim().length === 0) return fail('the body below the frontmatter must not be empty')

  return { id, title, oneLiner, body: body.trim() }
}

// Exported for tests (temp-dir fixtures); production callers use the cached
// `listVerifiedNotebooks` / `findVerifiedNotebookById` below.
export function loadVerifiedNotebooksFromDirectory(directory: string): VerifiedNotebook[] {
  const notebooks: VerifiedNotebook[] = []
  const seenIds = new Map<string, string>()
  const fileNames = readdirSync(directory)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort()
  for (const fileName of fileNames) {
    const notebook = parseVerifiedNotebook(fileName, readFileSync(join(directory, fileName), 'utf8'))
    const existing = seenIds.get(notebook.id)
    if (existing !== undefined) {
      throw new Error(
        `Verified notebooks "${existing}" and "${fileName}" both declare id "${notebook.id}" — ids must be unique; rename one.`,
      )
    }
    seenIds.set(notebook.id, fileName)
    notebooks.push(notebook)
  }
  return notebooks
}

let cachedShelf: VerifiedNotebook[] | null = null

export function listVerifiedNotebooks(): VerifiedNotebook[] {
  cachedShelf ??= loadVerifiedNotebooksFromDirectory(DEFAULT_NOTEBOOKS_DIR)
  return cachedShelf
}

export function findVerifiedNotebookById(notebookId: string): VerifiedNotebook | null {
  return listVerifiedNotebooks().find((notebook) => notebook.id === notebookId) ?? null
}
