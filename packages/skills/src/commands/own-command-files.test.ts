// The user's OWN slash-command doors over a real isolated home + workspace
// dir: write renders frontmatter from parts (and none when there is nothing
// to say), a save over a hand-authored file keeps the frontmatter keys Vynel
// does not model, namespaced names land in subfolders, delete 404s on a
// missing file and tidies an emptied namespace folder, and the safe-name
// predicate keeps the lister and the writers addressing the same files.

import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withHomeDir } from '../internal/resolve-host-home-dir.js'
import { parseCommandFile, renderCommandFile } from './command-file-frontmatter.js'
import {
  countCommandsForScope,
  listCommandsForScope,
  readCommandFileForScope,
} from './list-commands-for-scope.js'
import { writeOwnCommandFileForScope } from './write-own-command-file-for-scope.js'
import { deleteOwnCommandFileForScope } from './delete-own-command-file-for-scope.js'
import { isSafeCommandName } from './resolve-commands-root.js'

async function withIsolatedDirs<T>(
  fn: (homeDir: string, workspaceDir: string) => Promise<T>,
): Promise<T> {
  const homeDir = mkdtempSync(join(tmpdir(), 'vynel-own-commands-home-'))
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-own-commands-ws-'))
  try {
    return await withHomeDir(homeDir, () => fn(homeDir, workspaceDir))
  } finally {
    rmSync(homeDir, { recursive: true, force: true })
    rmSync(workspaceDir, { recursive: true, force: true })
  }
}

describe('writeOwnCommandFileForScope', () => {
  it('renders description + argument hint as frontmatter and the body after it', async () => {
    await withIsolatedDirs(async (homeDir) => {
      const { filePath } = await writeOwnCommandFileForScope({
        scope: 'user',
        commandName: 'review',
        description: 'Review a PR: carefully',
        argumentHint: '[pr]',
        body: 'Review PR $1.\n\n',
      })
      expect(filePath).toBe(join(homeDir, '.claude', 'commands', 'review.md'))
      expect(readFileSync(filePath, 'utf8')).toBe(
        '---\ndescription: "Review a PR: carefully"\nargument-hint: "[pr]"\n---\n\nReview PR $1.\n',
      )
      expect(readCommandFileForScope('user', 'review')).toMatchObject({
        commandName: 'review',
        description: 'Review a PR: carefully',
        argumentHint: '[pr]',
        bodyPreview: 'Review PR $1.',
      })
    })
  })

  it('writes a bare prompt with no frontmatter when there is nothing to put in it', async () => {
    await withIsolatedDirs(async (_homeDir, workspaceDir) => {
      await writeOwnCommandFileForScope({
        scope: 'workspace',
        workspacePath: workspaceDir,
        commandName: 'ship',
        body: 'Ship the branch.',
      })
      expect(readFileSync(join(workspaceDir, '.claude', 'commands', 'ship.md'), 'utf8')).toBe(
        'Ship the branch.\n',
      )
      expect(listCommandsForScope('user')).toEqual([])
    })
  })

  it('a namespaced name lands in a subfolder; the lister reads it back as git:commit', async () => {
    await withIsolatedDirs(async (homeDir) => {
      await writeOwnCommandFileForScope({
        scope: 'user',
        commandName: 'git:commit',
        body: 'Commit the work.',
      })
      expect(existsSync(join(homeDir, '.claude', 'commands', 'git', 'commit.md'))).toBe(true)
      expect(listCommandsForScope('user').map((command) => command.commandName)).toEqual([
        'git:commit',
      ])
      expect(countCommandsForScope('user')).toBe(1)
    })
  })

  it('keeps the frontmatter keys Vynel does not model when saving over a hand-authored file', async () => {
    await withIsolatedDirs(async (homeDir) => {
      const commandsDir = join(homeDir, '.claude', 'commands')
      mkdirSync(commandsDir, { recursive: true })
      writeFileSync(
        join(commandsDir, 'deploy.md'),
        '---\nallowed-tools: Bash(git:*)\ndescription: Old\nmodel: haiku\n---\nDeploy.\n',
        'utf8',
      )
      await writeOwnCommandFileForScope({
        scope: 'user',
        commandName: 'deploy',
        description: 'Deploy to production',
        body: 'Deploy carefully.',
      })
      expect(readFileSync(join(commandsDir, 'deploy.md'), 'utf8')).toBe(
        '---\ndescription: "Deploy to production"\nallowed-tools: Bash(git:*)\nmodel: haiku\n---\n\nDeploy carefully.\n',
      )
    })
  })

  it('refuses an empty body, a multi-line description, and an unsafe name', async () => {
    await withIsolatedDirs(async () => {
      await expect(
        writeOwnCommandFileForScope({ scope: 'user', commandName: 'blank', body: ' \n' }),
      ).rejects.toMatchObject({ code: 'validation_failed' })
      await expect(
        writeOwnCommandFileForScope({
          scope: 'user',
          commandName: 'two-lines',
          description: 'one\ntwo',
          body: 'x',
        }),
      ).rejects.toMatchObject({ code: 'validation_failed' })
      await expect(
        writeOwnCommandFileForScope({ scope: 'user', commandName: '..:escape', body: 'x' }),
      ).rejects.toMatchObject({ code: 'validation_failed' })
    })
  })
})

describe('deleteOwnCommandFileForScope', () => {
  it('removes the file, tidies an emptied namespace folder, and 404s once gone', async () => {
    await withIsolatedDirs(async (homeDir) => {
      const commandsDir = join(homeDir, '.claude', 'commands')
      await writeOwnCommandFileForScope({ scope: 'user', commandName: 'git:commit', body: 'a' })
      await writeOwnCommandFileForScope({ scope: 'user', commandName: 'git:push', body: 'b' })

      await deleteOwnCommandFileForScope({ scope: 'user', commandName: 'git:commit' })
      expect(existsSync(join(commandsDir, 'git', 'commit.md'))).toBe(false)
      expect(existsSync(join(commandsDir, 'git'))).toBe(true)

      await deleteOwnCommandFileForScope({ scope: 'user', commandName: 'git:push' })
      expect(existsSync(join(commandsDir, 'git'))).toBe(false)
      expect(existsSync(commandsDir)).toBe(true)

      await expect(
        deleteOwnCommandFileForScope({ scope: 'user', commandName: 'git:push' }),
      ).rejects.toMatchObject({ code: 'not_found' })
    })
  })
})

describe('the command-name predicate + the folder read', () => {
  it('accepts stems joined by ":", rejects anything that could leave the folder', () => {
    expect(isSafeCommandName('review')).toBe(true)
    expect(isSafeCommandName('git:commit')).toBe(true)
    expect(isSafeCommandName('a:b:c:d:e')).toBe(true)
    expect(isSafeCommandName('a:b:c:d:e:f')).toBe(false)
    expect(isSafeCommandName('')).toBe(false)
    expect(isSafeCommandName('git:')).toBe(false)
    expect(isSafeCommandName('.hidden')).toBe(false)
    expect(isSafeCommandName('..:x')).toBe(false)
    expect(isSafeCommandName('a/b')).toBe(false)
  })

  it('the lister skips a file (or folder) the writers could not address', async () => {
    await withIsolatedDirs(async (homeDir) => {
      const commandsDir = join(homeDir, '.claude', 'commands')
      mkdirSync(join(commandsDir, '.hidden-ns'), { recursive: true })
      writeFileSync(join(commandsDir, '.hidden-ns', 'x.md'), 'x', 'utf8')
      writeFileSync(join(commandsDir, '.draft.md'), 'x', 'utf8')
      writeFileSync(join(commandsDir, 'ok.md'), 'ok', 'utf8')
      expect(listCommandsForScope('user').map((command) => command.commandName)).toEqual(['ok'])
      expect(countCommandsForScope('user')).toBe(1)
    })
  })
})

describe('parseCommandFile / renderCommandFile', () => {
  it('round-trips a file with extra keys and a BOM + CRLF re-save', () => {
    const parsed = parseCommandFile(
      '﻿---\r\ndescription: "A: b"\r\nmodel: haiku\r\n---\r\n\r\nBody.\r\n',
    )
    expect(parsed).toEqual({
      description: 'A: b',
      argumentHint: null,
      extraFrontmatterLines: ['model: haiku'],
      body: '\nBody.\n',
    })
    expect(renderCommandFile(parsed)).toBe('---\ndescription: "A: b"\nmodel: haiku\n---\n\nBody.\n')
  })
})
