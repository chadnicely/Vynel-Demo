// Tests for the `#workspace` study-tool logic — real temp directories on
// disk (the guards ARE the feature; mocking fs would test nothing).

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  getWorkspaceOverviewForStudy,
  listWorkspaceFilesForStudy,
  readWorkspaceFileForStudy,
  resolveContainedPath,
  resolveStudyWorkspace,
  type StudyWorkspace,
} from './workspace-study-tools.js'

let root: string
let outside: string
let workspace: StudyWorkspace

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vynel-study-'))
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'vynel-outside-'))
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'top secret')
  fs.mkdirSync(path.join(root, 'src'))
  fs.mkdirSync(path.join(root, 'node_modules', 'left-pad'), { recursive: true })
  fs.writeFileSync(path.join(root, 'README.md'), '# Hello workspace')
  fs.writeFileSync(path.join(root, 'src', 'index.ts'), 'export const x = 1\n')
  fs.writeFileSync(path.join(root, 'node_modules', 'left-pad', 'index.js'), 'nope')
  workspace = { id: 'ws-1', name: 'Acme', path: root, managerName: 'Mark' }
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(outside, { recursive: true, force: true })
})

describe('resolveStudyWorkspace — id gating', () => {
  it('resolves an allowed id and rejects everything else, naming the legal set', () => {
    expect(resolveStudyWorkspace([workspace], 'ws-1')).toBe(workspace)
    expect(() => resolveStudyWorkspace([workspace], 'ws-2')).toThrow(/not study-readable/)
    expect(() => resolveStudyWorkspace([workspace], 'ws-2')).toThrow(/"Acme" \(ws-1\)/)
  })
})

describe('resolveContainedPath — the path guard', () => {
  it('accepts in-root relative paths (including ".")', () => {
    expect(resolveContainedPath(root, '.')).toBe(path.resolve(root))
    expect(resolveContainedPath(root, 'src/index.ts')).toBe(
      path.resolve(root, 'src', 'index.ts'),
    )
  })

  it('rejects absolute paths, .. escapes, and null bytes', () => {
    expect(() => resolveContainedPath(root, path.join(outside, 'secret.txt'))).toThrow(
      /absolute/,
    )
    expect(() => resolveContainedPath(root, '../')).toThrow(/escapes/)
    expect(() => resolveContainedPath(root, 'src/../../etc/passwd')).toThrow(/escapes/)
    expect(() => resolveContainedPath(root, 'a\0b')).toThrow(/null byte/)
  })

  it('a sibling-prefix directory never passes the containment check', () => {
    // root = …/vynel-study-XXX; a path resolving to …/vynel-study-XXXevil must
    // not slip through a naive startsWith.
    const sibling = `${root}evil`
    fs.mkdirSync(sibling, { recursive: true })
    try {
      expect(() =>
        resolveContainedPath(root, path.join('..', path.basename(sibling), 'x')),
      ).toThrow(/escapes/)
    } finally {
      fs.rmSync(sibling, { recursive: true, force: true })
    }
  })

  it('refuses a symlink inside the tree that points outside it', () => {
    const linkPath = path.join(root, 'sneaky.txt')
    try {
      fs.symlinkSync(path.join(outside, 'secret.txt'), linkPath)
    } catch {
      return // symlink creation needs privileges on some Windows setups — guard elsewhere still holds
    }
    expect(() => resolveContainedPath(root, 'sneaky.txt')).toThrow(/symlink/)
  })
})

describe('listWorkspaceFilesForStudy', () => {
  it('lists the tree with dirs first, skipping dependency folders', () => {
    const listing = listWorkspaceFilesForStudy(workspace)
    expect(listing.entries).toEqual(['src/', 'src/index.ts', 'README.md'])
    expect(listing.truncated).toBe(false)
  })

  it('narrows to a subdirectory and rejects non-directories', () => {
    expect(listWorkspaceFilesForStudy(workspace, 'src').entries).toEqual(['src/index.ts'])
    expect(() => listWorkspaceFilesForStudy(workspace, 'README.md')).toThrow(
      /not a directory/,
    )
    expect(() => listWorkspaceFilesForStudy(workspace, 'missing')).toThrow(/not a directory/)
  })

  it('caps the entry count and reports truncation', () => {
    for (let i = 0; i < 450; i += 1) {
      fs.writeFileSync(path.join(root, `file-${String(i).padStart(3, '0')}.txt`), 'x')
    }
    const listing = listWorkspaceFilesForStudy(workspace)
    expect(listing.entries.length).toBeLessThanOrEqual(400)
    expect(listing.truncated).toBe(true)
  })
})

describe('readWorkspaceFileForStudy', () => {
  it('reads a text file', () => {
    const file = readWorkspaceFileForStudy(workspace, 'README.md')
    expect(file.content).toBe('# Hello workspace')
    expect(file.truncated).toBe(false)
  })

  it('caps oversized files and flags the truncation', () => {
    fs.writeFileSync(path.join(root, 'big.txt'), 'a'.repeat(300_000))
    const file = readWorkspaceFileForStudy(workspace, 'big.txt')
    expect(file.content.length).toBe(256_000)
    expect(file.truncated).toBe(true)
  })

  it('refuses binary files, directories, and missing files', () => {
    fs.writeFileSync(path.join(root, 'blob.bin'), Buffer.from([0x89, 0x50, 0x00, 0x47]))
    expect(() => readWorkspaceFileForStudy(workspace, 'blob.bin')).toThrow(/binary/)
    expect(() => readWorkspaceFileForStudy(workspace, 'src')).toThrow(/not a file/)
    expect(() => readWorkspaceFileForStudy(workspace, 'nope.txt')).toThrow(/not a file/)
  })
})

describe('getWorkspaceOverviewForStudy', () => {
  it('returns identity + top-level entries, skipping dependency dirs', () => {
    const overview = getWorkspaceOverviewForStudy(workspace)
    expect(overview.name).toBe('Acme')
    expect(overview.managerName).toBe('Mark')
    expect(overview.path).toBe(root)
    expect(overview.topLevelEntries).toEqual(['src/', 'README.md'])
  })

  it('a vanished workspace folder yields empty entries, never a throw', () => {
    const gone = { ...workspace, path: path.join(root, 'not-there') }
    expect(getWorkspaceOverviewForStudy(gone).topLevelEntries).toEqual([])
  })
})
