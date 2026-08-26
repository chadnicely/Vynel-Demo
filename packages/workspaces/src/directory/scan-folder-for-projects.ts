// "Which project?" — look inside a folder the user pointed at and say what is
// in there (Chad, 2026-08-24: the in-app folder tree "is super techy and
// complicated"; the user already knows where their project is).
//
// The rules are his prototype's: a project is a folder with a `package.json`
// or a `.git`, and we look one level down so pointing at a folder-of-projects
// works as well as pointing at one project. Deeper than that is guesswork,
// and a wrong guess here adopts the wrong folder.
//
// Three honest answers, never an error:
//   `single`  — the folder IS a project; adopt it.
//   `several` — it HOLDS projects; the user ticks which ones.
//   `none`    — nothing recognisable. The screen offers "add it anyway",
//               because a folder we do not recognise can still be theirs.

import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { resolveExistingDirectory } from './resolve-existing-directory.js'

/** Build output and dependency folders are never projects, and walking them is
 *  slow enough to make the screen feel broken. His prototype's list. */
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'release',
  '.next',
  '.wrangler',
  'coverage',
  '.turbo',
  'target',
  'vendor',
  '__pycache__',
])

/** What marks a folder as somebody's project. `package.json` and `.git` are
 *  his two; the rest are the same promise for languages that do not use npm —
 *  a non-technical Python or Go user should not be told their project is
 *  unrecognisable. */
const PROJECT_MARKERS = [
  'package.json',
  '.git',
  'pyproject.toml',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  'Gemfile',
  'composer.json',
  'pom.xml',
  'build.gradle',
]

export type ScannedProject = {
  /** Absolute, canonical — what `createWorkspace` will store. */
  path: string
  /** The folder's own name, which is what the user recognises. */
  name: string
  /** Which marker found it, so the screen can say WHY it thinks so. */
  foundBy: string
}

export type FolderScan =
  | { kind: 'single'; project: ScannedProject }
  | { kind: 'several'; projects: ScannedProject[] }
  | { kind: 'none' }

async function findMarker(directory: string): Promise<string | null> {
  for (const marker of PROJECT_MARKERS) {
    try {
      await stat(path.join(directory, marker))
      return marker
    } catch {
      // Absent is the normal case, not a failure.
    }
  }
  return null
}

export async function scanFolderForProjects(rawDirectory: string): Promise<FolderScan> {
  const directory = await resolveExistingDirectory(rawDirectory)

  const ownMarker = await findMarker(directory)
  if (ownMarker !== null) {
    return {
      kind: 'single',
      project: { path: directory, name: path.basename(directory), foundBy: ownMarker },
    }
  }

  let childNames: string[]
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    childNames = entries.filter((entry) => entry.isDirectory()).map((entry) => String(entry.name))
  } catch {
    // Unreadable reads as empty — the screen's "add it anyway" still works.
    return { kind: 'none' }
  }

  const projects: ScannedProject[] = []
  for (const name of childNames) {
    if (name.startsWith('.')) continue
    if (SKIP_DIRECTORIES.has(name)) continue

    const child = path.join(directory, name)
    const marker = await findMarker(child)
    if (marker !== null) {
      projects.push({ path: child, name, foundBy: marker })
    }
  }

  if (projects.length === 0) return { kind: 'none' }
  // One child project still means "the user pointed at a folder that holds
  // projects" — keep it as `several` so the screen shows what it found and the
  // user confirms, rather than silently adopting a child they did not name.
  return { kind: 'several', projects: projects.sort((a, b) => a.name.localeCompare(b.name)) }
}
