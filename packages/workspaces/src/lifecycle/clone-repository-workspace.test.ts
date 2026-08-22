import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { withTestDatabase } from '@vynel/testing'
import { ConflictError, NotFoundError, ValidationError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import {
  insertWorkspace,
  insertWorkspaceGroup,
  listWorkspacesForUser,
} from '@vynel/db/repositories/workspaces'
import { cloneRepositoryWorkspace } from './clone-repository-workspace.js'

// A faked git that never touches the network: the folder already exists
// (createChildDirectory made it), so a `clone` just records the call — and,
// if asked, fails the way git or the spawn would.
function makeGitRunner(behaviour: { fail?: unknown } = {}) {
  const calls: { args: string[]; cwd: string }[] = []
  const runGit = async (args: string[], cwd: string) => {
    calls.push({ args, cwd })
    if (behaviour.fail !== undefined) throw behaviour.fail
  }
  return { runGit, calls }
}

function makeUser(id: string = randomUUID()) {
  return {
    id,
    displayName: 'Test',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function chosenFolder(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'vynel-clone-'))
}

const URL = 'https://github.com/acme/pricing.git'

describe('cloneRepositoryWorkspace', () => {
  it('clones into a fresh folder inside the chosen one and registers it, filed into the group', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const now = new Date()
      const group = insertWorkspaceGroup(db, {
        id: randomUUID(),
        userId: user.id,
        name: 'Clients',
        createdAt: now,
        updatedAt: now,
      })
      const parent = chosenFolder()
      const { runGit, calls } = makeGitRunner()

      const { workspace } = await cloneRepositoryWorkspace(
        db,
        { userId: user.id, name: 'Pricing', parentPath: parent, repositoryUrl: URL, groupId: group.id },
        { runGit },
      )

      const directory = path.join(realpathSync(parent), 'Pricing')
      expect(workspace.path).toBe(directory)
      expect(workspace.groupId).toBe(group.id)
      expect(existsSync(path.join(directory, '.vynel'))).toBe(true)
      // git was handed the URL after `--`, into the folder we made.
      expect(calls).toEqual([{ args: ['clone', '--', URL, directory], cwd: parent }])
    })
  })

  it('refuses an address that is not a remote — including an option dressed as scp — and never runs git', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const parent = chosenFolder()
      const { runGit, calls } = makeGitRunner()
      for (const repositoryUrl of [
        '',
        '-oProxyCommand=evil',
        '-x@github.com:acme/x.git',
        'C:\\local\\path',
        'https://x.y/a b',
      ]) {
        await expect(
          cloneRepositoryWorkspace(
            db,
            { userId: user.id, name: 'Bad', parentPath: parent, repositoryUrl },
            { runGit },
          ),
        ).rejects.toBeInstanceOf(ValidationError)
      }
      expect(calls).toEqual([])
      expect(readdirSync(parent)).toEqual([])
    })
  })

  it('a folder name can never climb out of the chosen folder', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const parent = chosenFolder()
      const { runGit } = makeGitRunner()

      const { workspace } = await cloneRepositoryWorkspace(
        db,
        { userId: user.id, name: 'Escape', parentPath: parent, repositoryUrl: URL, folderName: '../escape' },
        { runGit },
      )

      expect(path.dirname(workspace.path)).toBe(realpathSync(parent))
      expect(path.basename(workspace.path)).toBe('.._escape')
    })
  })

  it("a failed clone removes the folder, says git's own reason — never the command line — and registers nothing", async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const parent = chosenFolder()
      const warnings: string[] = []
      const logger = { info: () => {}, warn: (_obj: object, msg: string) => warnings.push(msg) }
      const gitError = new Error(
        'Command failed: git -c protocol.ext.allow=never clone -- https://user:TOKEN@host/x.git C:\\x\nfatal: Authentication failed for the remote',
      )

      await expect(
        cloneRepositoryWorkspace(
          db,
          { userId: user.id, name: 'Private', parentPath: parent, repositoryUrl: 'git@github.com:acme/private.git' },
          { runGit: makeGitRunner({ fail: gitError }).runGit, logger },
        ),
      ).rejects.toThrow(/^Could not clone that repository — Authentication failed for the remote$/)

      expect(existsSync(path.join(parent, 'Private'))).toBe(false)
      expect(listWorkspacesForUser(db, user.id)).toEqual([])
      expect(warnings).toEqual(['git clone failed'])
    })
  })

  it('git missing and a timed-out clone are said in plain words', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const parent = chosenFolder()
      const missing = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })
      await expect(
        cloneRepositoryWorkspace(
          db,
          { userId: user.id, name: 'NoGit', parentPath: parent, repositoryUrl: URL },
          { runGit: makeGitRunner({ fail: missing }).runGit },
        ),
      ).rejects.toThrow(/git isn't installed on this computer/)

      const timedOut = Object.assign(new Error('Command failed: git clone …'), { killed: true })
      await expect(
        cloneRepositoryWorkspace(
          db,
          { userId: user.id, name: 'Slow', parentPath: parent, repositoryUrl: URL },
          { runGit: makeGitRunner({ fail: timedOut }).runGit },
        ),
      ).rejects.toThrow(/longer than five minutes/)
      expect(readdirSync(parent)).toEqual([])
    })
  })

  it('a clone that succeeds but cannot be registered is taken back too', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const parent = chosenFolder()
      // A row already claims the path the clone is about to make — the
      // dedup in createWorkspace fires AFTER the folder exists.
      const now = new Date()
      insertWorkspace(db, {
        id: randomUUID(),
        userId: user.id,
        name: 'Ghost',
        managerName: null,
        kind: 'personal',
        path: path.join(realpathSync(parent), 'Taken'),
        groupId: null,
        isArchived: false,
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: now,
      })

      await expect(
        cloneRepositoryWorkspace(
          db,
          { userId: user.id, name: 'Taken', parentPath: parent, repositoryUrl: URL },
          { runGit: makeGitRunner().runGit },
        ),
      ).rejects.toBeInstanceOf(ConflictError)
      expect(existsSync(path.join(parent, 'Taken'))).toBe(false)
    })
  })

  it('a folder already there is a ConflictError; a missing chosen folder and a foreign group are refused before git', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const parent = chosenFolder()
      mkdirSync(path.join(parent, 'Taken'))
      const { runGit, calls } = makeGitRunner()
      const base = { userId: user.id, repositoryUrl: URL }

      await expect(
        cloneRepositoryWorkspace(db, { ...base, name: 'Taken', parentPath: parent }, { runGit }),
      ).rejects.toBeInstanceOf(ConflictError)
      await expect(
        cloneRepositoryWorkspace(
          db,
          { ...base, name: 'X', parentPath: path.join(os.tmpdir(), `vynel-missing-${randomUUID()}`) },
          { runGit },
        ),
      ).rejects.toBeInstanceOf(ValidationError)
      await expect(
        cloneRepositoryWorkspace(
          db,
          { ...base, name: 'X', parentPath: parent, groupId: randomUUID() },
          { runGit },
        ),
      ).rejects.toBeInstanceOf(NotFoundError)
      expect(calls).toEqual([])
      expect(existsSync(path.join(parent, 'Taken'))).toBe(true)
    })
  })
})
