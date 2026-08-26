// The commands folder read: flat + namespaced (subfolder) files, frontmatter
// with and without the two known keys, preview extraction, and the lenient
// missing-folder posture — on both scopes via the host-home seam.

import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withHomeDir } from '../internal/resolve-host-home-dir.js'
import { listCommandsForScope } from './list-commands-for-scope.js'

async function withCommandsDir<T>(
  scope: 'user' | 'workspace',
  fn: (commandsDir: string, workspaceDir: string) => Promise<T>,
): Promise<T> {
  const homeDir = mkdtempSync(join(tmpdir(), 'vynel-commands-home-'))
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-commands-ws-'))
  const commandsDir =
    scope === 'user'
      ? join(homeDir, '.claude', 'commands')
      : join(workspaceDir, '.claude', 'commands')
  mkdirSync(commandsDir, { recursive: true })
  try {
    return await withHomeDir(homeDir, () => fn(commandsDir, workspaceDir))
  } finally {
    rmSync(homeDir, { recursive: true, force: true })
    rmSync(workspaceDir, { recursive: true, force: true })
  }
}

describe('listCommandsForScope', () => {
  it('parses frontmatter description + argument-hint and previews the body', async () => {
    await withCommandsDir('user', async (commandsDir) => {
      writeFileSync(
        join(commandsDir, 'review.md'),
        '---\ndescription: Review a pull request\nargument-hint: "[pr-number]"\n---\n\nReview PR $1 carefully.\n',
        'utf8',
      )
      expect(listCommandsForScope('user')).toEqual([
        {
          commandName: 'review',
          relativePath: 'review.md',
          description: 'Review a pull request',
          argumentHint: '[pr-number]',
          bodyPreview: 'Review PR $1 carefully.',
          // The whole file rides the row (2026-08-26) — the view + edit dialog's read.
          content:
            '---\ndescription: Review a pull request\nargument-hint: "[pr-number]"\n---\n\nReview PR $1 carefully.\n',
          body: 'Review PR $1 carefully.\n',
        },
      ])
    })
  })

  it('handles a file with no frontmatter — the body starts at line one', async () => {
    await withCommandsDir('user', async (commandsDir) => {
      writeFileSync(join(commandsDir, 'ship.md'), '\nShip the current branch.\n', 'utf8')
      expect(listCommandsForScope('user')[0]).toMatchObject({
        commandName: 'ship',
        description: null,
        argumentHint: null,
        bodyPreview: 'Ship the current branch.',
      })
    })
  })

  it('namespaces subfolder commands with ":" (git/commit.md → git:commit)', async () => {
    await withCommandsDir('user', async (commandsDir) => {
      mkdirSync(join(commandsDir, 'git'), { recursive: true })
      writeFileSync(join(commandsDir, 'git', 'commit.md'), 'Commit the work.\n', 'utf8')
      writeFileSync(join(commandsDir, 'top.md'), 'Top level.\n', 'utf8')
      expect(listCommandsForScope('user').map((command) => command.commandName)).toEqual([
        'git:commit',
        'top',
      ])
    })
  })

  it('reads the workspace scope folder and skips non-md files', async () => {
    await withCommandsDir('workspace', async (commandsDir, workspaceDir) => {
      writeFileSync(join(commandsDir, 'deploy.md'), 'Deploy it.\n', 'utf8')
      writeFileSync(join(commandsDir, 'readme.txt'), 'not a command', 'utf8')
      expect(listCommandsForScope('workspace', workspaceDir).map((c) => c.commandName)).toEqual([
        'deploy',
      ])
    })
  })

  it('tolerates BOM + CRLF frontmatter', async () => {
    await withCommandsDir('user', async (commandsDir) => {
      const content = '---\r\ndescription: Windowsy\r\n---\r\nBody line.\r\n'
      writeFileSync(join(commandsDir, 'win.md'), `\uFEFF${content}`, 'utf8')
      expect(listCommandsForScope('user')[0]).toMatchObject({
        description: 'Windowsy',
        bodyPreview: 'Body line.',
      })
    })
  })

  it('answers empty when the folder does not exist', () => {
    expect(
      listCommandsForScope('workspace', join(tmpdir(), 'vynel-commands-none-does-not-exist')),
    ).toEqual([])
  })
})
