import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
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

// A faked git that never touches the network: a `clone` drops what a clone
// would into the (existing, empty) target, then — if asked — fails the way
// git or the spawn would, so the cleanup path has something to take back.
function makeGitRunner(behaviour: { fail?: unknown } = {}) {
  const calls: { args: string[]; cwd: string }[] = []
  const runGit = async (args: string[], cwd: string) => {
    calls.push({ args, cwd })
    if (args[0] === 'clone') {
      const target = args[3]!
      mkdirSync(path.join(target, '.git'))
      writeFileSync(path.join(target, 'README.md'), '# cloned\n')
    }
    if (behaviour.fail !== undefined) throw behaviour.fail
    return ''
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

// The folder the user chose (or made with New folder) — the clone lands IN it.
function chosenFolder(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'vynel-clone-'))
}

const URL = 'https://github.com/acme/pricing.git'

describe('cloneRepositoryWorkspace', () => {
  it('clones INTO the chosen folder and registers it, filed into the group', async () => {
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
      const folder = chosenFolder()
      const { runGit, calls } = makeGitRunner()

      const { workspace } = await cloneRepositoryWorkspace(
        db,
        { userId: user.id, name: 'Pricing', directory: folder, repositoryUrl: URL, groupId: group.id },
        { runGit },
      )

      const directory = realpathSync(folder)
      expect(workspace.path).toBe(directory)
      expect(workspace.groupId).toBe(group.id)
      expect(existsSync(path.join(directory, '.vynel'))).toBe(true)
      // git was handed the URL after `--`, with the chosen folder as the target.
      expect(calls).toEqual([{ args: ['clone', '--', URL, directory], cwd: directory }])
    })
  })

  it('refuses an address that is not a remote — including an option dressed as scp — and never runs git', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const folder = chosenFolder()
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
            { userId: user.id, name: 'Bad', directory: folder, repositoryUrl },
            { runGit },
          ),
        ).rejects.toBeInstanceOf(ValidationError)
      }
      expect(calls).toEqual([])
      expect(readdirSync(folder)).toEqual([])
    })
  })

  it('refuses a folder that already has things in it — a clone never lands on top of files', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const folder = chosenFolder()
      writeFileSync(path.join(folder, 'theirs.txt'), 'x')
      const { runGit, calls } = makeGitRunner()

      await expect(
        cloneRepositoryWorkspace(
          db,
          { userId: user.id, name: 'Busy', directory: folder, repositoryUrl: URL },
          { runGit },
        ),
      ).rejects.toThrow(/already has things in it/)
      expect(calls).toEqual([])
      expect(readdirSync(folder)).toEqual(['theirs.txt'])
    })
  })

  it("a failed clone empties the folder again, says git's own reason — never the command line — and registers nothing", async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const folder = chosenFolder()
      const warnings: string[] = []
      const logger = { info: () => {}, warn: (_obj: object, msg: string) => warnings.push(msg) }
      const gitError = new Error(
        'Command failed: git -c protocol.ext.allow=never clone -- https://user:TOKEN@host/x.git C:\\x\nfatal: Authentication failed for the remote',
      )

      await expect(
        cloneRepositoryWorkspace(
          db,
          { userId: user.id, name: 'Private', directory: folder, repositoryUrl: 'git@github.com:acme/private.git' },
          { runGit: makeGitRunner({ fail: gitError }).runGit, logger },
        ),
      ).rejects.toThrow(/^Could not clone that repository — Authentication failed for the remote$/)

      expect(existsSync(folder)).toBe(true)
      expect(readdirSync(folder)).toEqual([])
      expect(listWorkspacesForUser(db, user.id)).toEqual([])
      expect(warnings).toEqual(['git clone failed'])
    })
  })

  it('git missing and a timed-out clone are said in plain words', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const folder = chosenFolder()
      const missing = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })
      await expect(
        cloneRepositoryWorkspace(
          db,
          { userId: user.id, name: 'NoGit', directory: folder, repositoryUrl: URL },
          { runGit: makeGitRunner({ fail: missing }).runGit },
        ),
      ).rejects.toThrow(/git isn't installed on this computer/)

      const timedOut = Object.assign(new Error('Command failed: git clone …'), { killed: true })
      await expect(
        cloneRepositoryWorkspace(
          db,
          { userId: user.id, name: 'Slow', directory: folder, repositoryUrl: URL },
          { runGit: makeGitRunner({ fail: timedOut }).runGit },
        ),
      ).rejects.toThrow(/longer than five minutes/)
      expect(readdirSync(folder)).toEqual([])
    })
  })

  it('a clone that succeeds but cannot be registered is taken back too', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const folder = chosenFolder()
      // A row already claims this very folder — createWorkspace's dedup fires
      // AFTER the clone landed.
      const now = new Date()
      insertWorkspace(db, {
        id: randomUUID(),
        userId: user.id,
        name: 'Ghost',
        managerName: null,
        kind: 'personal',
        path: realpathSync(folder),
        groupId: null,
        isArchived: false,
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: now,
      })

      await expect(
        cloneRepositoryWorkspace(
          db,
          { userId: user.id, name: 'Taken', directory: folder, repositoryUrl: URL },
          { runGit: makeGitRunner().runGit },
        ),
      ).rejects.toBeInstanceOf(ConflictError)
      expect(readdirSync(folder)).toEqual([])
    })
  })

  it('a missing chosen folder and a foreign group are refused before git', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const folder = chosenFolder()
      const { runGit, calls } = makeGitRunner()
      const base = { userId: user.id, repositoryUrl: URL }

      await expect(
        cloneRepositoryWorkspace(
          db,
          { ...base, name: 'X', directory: path.join(os.tmpdir(), `vynel-missing-${randomUUID()}`) },
          { runGit },
        ),
      ).rejects.toBeInstanceOf(ValidationError)
      await expect(
        cloneRepositoryWorkspace(
          db,
          { ...base, name: 'X', directory: folder, groupId: randomUUID() },
          { runGit },
        ),
      ).rejects.toBeInstanceOf(NotFoundError)
      expect(calls).toEqual([])
      expect(readdirSync(folder)).toEqual([])
    })
  })
})
