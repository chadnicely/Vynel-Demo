import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { withTestDatabase } from '@vynel/testing'
import { ConflictError, NotFoundError, ValidationError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import {
  findWorkspaceById,
  findWorkspaceBriefByWorkspaceId,
  insertWorkspace,
  insertWorkspaceGroup,
  listWorkspacesForUser,
} from '@vynel/db/repositories/workspaces'
import type { WorkspaceBriefAnswers, WorkspacePlan } from '@vynel/contracts/workspaces/workspace-brief'
import { scaffoldWorkspace } from './scaffold-workspace.js'
import type { GitRunner } from '../git/run-git.js'

function makeUser(id: string = randomUUID()) {
  return {
    id,
    displayName: 'Test',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

// The folder the user chose on screen 1 — this IS the workspace.
function chosenFolder(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'vynel-scaffold-'))
}

const ANSWERS: WorkspaceBriefAnswers = {
  idea: 'A place where my regulars can book a table.',
  audience: 'My customers',
  firstThing: 'Book a table',
  signIn: 'No, open to everyone',
  where: 'A website',
  remembers: ['Bookings'],
  wants: [],
  leftOut: [],
  changeRequests: ['No sign-in just to look.'],
  goalNotes: [],
  stack: { front: 'Next.js', back: 'Next.js API routes', database: 'SQLite' },
}

const PLAN: WorkspacePlan = {
  oneLine: 'A website where your customers can book a table.',
  build: [{ text: 'Let people book a table', source: 'your answers' }],
  remembers: ['Bookings'],
  leftOut: [],
  mvpNutshell: 'The smallest version worth using.',
  goals: [{ title: 'Somewhere your people can book', bullets: ['One screen'] }],
  sessions: [{ name: 'Set the project up', items: ['Create the first page'], mvp: true }],
}

// Records every git call instead of shelling out; `init` makes the .git
// folder the way git would, so cleanup has something real to take back.
function fakeGit(calls: { args: string[]; cwd: string }[]): GitRunner {
  return async (args, cwd) => {
    calls.push({ args, cwd })
    if (args[0] === 'init') mkdirSync(path.join(cwd, '.git'))
    return ''
  }
}

describe('scaffoldWorkspace', () => {
  it('uses the chosen folder itself: README, .gitignore, git, the row, the brief', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const folder = chosenFolder()
      const gitCalls: { args: string[]; cwd: string }[] = []

      const made = await scaffoldWorkspace(
        db,
        { userId: user.id, name: 'Front of House', directory: folder, answers: ANSWERS, plan: PLAN },
        { runGit: fakeGit(gitCalls) },
      )

      const expectedDir = realpathSync(folder)
      expect(made.workspace.path).toBe(expectedDir)
      expect(made.workspace.name).toBe('Front of House')
      expect(made.workspace.groupId).toBeNull()
      expect(existsSync(path.join(expectedDir, '.vynel'))).toBe(true)
      expect(readFileSync(path.join(expectedDir, 'README.md'), 'utf8')).toContain('- Front end: Next.js')
      // Vynel's metadata never enters the project's history.
      expect(readFileSync(path.join(expectedDir, '.gitignore'), 'utf8')).toBe('.vynel/\n')

      expect(made.git).toEqual({ kind: 'initialized' })
      expect(gitCalls.map((call) => (call.args[0] === '-c' ? 'commit' : call.args[0]))).toEqual([
        'init',
        'add',
        'commit',
      ])
      // Only the scaffold's own files go into the first commit.
      expect(gitCalls[1]?.args).toEqual(['add', '--', 'README.md', '.gitignore'])
      expect(gitCalls.every((call) => call.cwd === expectedDir)).toBe(true)

      expect(made.brief.workspaceId).toBe(made.workspace.id)
      expect(made.brief.plan).toEqual(PLAN)
      expect(made.brief.brief).toContain('Build Front of House — the MVP first.')
      expect(made.brief.brief).toContain('- No sign-in just to look.')
      expect(made.brief.brief).not.toContain('(Note:')
      expect(findWorkspaceBriefByWorkspaceId(db, made.workspace.id)?.brief).toBe(made.brief.brief)
      expect(findWorkspaceById(db, made.workspace.id)?.path).toBe(expectedDir)
    })
  })

  it('files the row into the group, and never overwrites what the folder already had', async () => {
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
      writeFileSync(path.join(folder, 'README.md'), '# Theirs\n')
      mkdirSync(path.join(folder, '.git'))
      const gitCalls: { args: string[]; cwd: string }[] = []

      const made = await scaffoldWorkspace(
        db,
        { userId: user.id, name: 'Front of House', directory: folder, groupId: group.id, answers: ANSWERS, plan: PLAN },
        { runGit: fakeGit(gitCalls) },
      )

      expect(made.workspace.groupId).toBe(group.id)
      expect(readFileSync(path.join(folder, 'README.md'), 'utf8')).toBe('# Theirs\n')
      // A folder with a history keeps it — git is not touched.
      expect(made.git).toEqual({ kind: 'existing' })
      expect(gitCalls).toEqual([])
      expect(existsSync(path.join(folder, '.gitignore'))).toBe(true)
    })
  })

  it("never sweeps the user's own files into the first commit", async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const folder = chosenFolder()
      writeFileSync(path.join(folder, '.env'), 'SECRET=1')
      writeFileSync(path.join(folder, '.gitignore'), 'node_modules\n')
      const gitCalls: { args: string[]; cwd: string }[] = []

      const made = await scaffoldWorkspace(
        db,
        { userId: user.id, name: 'Mine', directory: folder, answers: ANSWERS, plan: PLAN },
        { runGit: fakeGit(gitCalls) },
      )

      expect(made.git).toEqual({ kind: 'initialized' })
      // Their .gitignore is kept; only the README the scaffold wrote is added.
      expect(gitCalls[1]?.args).toEqual(['add', '--', 'README.md'])
      expect(readFileSync(path.join(folder, '.gitignore'), 'utf8')).toBe('node_modules\n')

      // Both files already there → nothing to add, history still starts.
      const full = chosenFolder()
      writeFileSync(path.join(full, 'README.md'), '# Theirs\n')
      writeFileSync(path.join(full, '.gitignore'), 'dist\n')
      const calls: { args: string[]; cwd: string }[] = []
      await scaffoldWorkspace(
        db,
        { userId: user.id, name: 'Full', directory: full, answers: ANSWERS, plan: PLAN },
        { runGit: fakeGit(calls) },
      )
      expect(calls.map((call) => call.args[0])).toEqual(['init', '-c'])
      expect(calls[1]?.args).toContain('--allow-empty')
    })
  })

  it('a machine without git still gets a healthy workspace — said plainly, in the brief too', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const folder = chosenFolder()
      const warnings: string[] = []
      const noGit: GitRunner = async () => {
        throw new Error('spawn git ENOENT')
      }

      const made = await scaffoldWorkspace(
        db,
        { userId: user.id, name: 'Offline', directory: folder, answers: ANSWERS, plan: PLAN },
        { runGit: noGit, logger: { info: () => {}, warn: (_obj, msg) => warnings.push(msg) } },
      )

      expect(made.git.kind).toBe('skipped')
      expect(made.brief.brief).toContain("(Note: Git couldn't start a history")
      expect(warnings).toEqual(['git could not initialise the new workspace'])
      expect(findWorkspaceById(db, made.workspace.id)).not.toBeNull()
    })
  })

  it('a folder that is already a workspace is refused, and only what we added is taken back', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const folder = chosenFolder()
      writeFileSync(path.join(folder, 'notes.txt'), 'theirs')
      const now = new Date()
      insertWorkspace(db, {
        id: randomUUID(),
        userId: user.id,
        name: 'Already',
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
        scaffoldWorkspace(
          db,
          { userId: user.id, name: 'Again', directory: folder, answers: ANSWERS, plan: PLAN },
          { runGit: fakeGit([]) },
        ),
      ).rejects.toBeInstanceOf(ConflictError)

      // The user's file stays; our README, .gitignore and .git are gone.
      expect(readdirSync(folder).sort()).toEqual(['notes.txt'])
      expect(listWorkspacesForUser(db, user.id).map((row) => row.name)).toEqual(['Already'])
      for (const row of listWorkspacesForUser(db, user.id)) {
        expect(findWorkspaceBriefByWorkspaceId(db, row.id)).toBeNull()
      }
    })
  })

  it('a missing chosen folder is a ValidationError; a foreign group is a NotFoundError before anything is written', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const missing = path.join(os.tmpdir(), `vynel-missing-${randomUUID()}`)

      await expect(
        scaffoldWorkspace(
          db,
          { userId: user.id, name: 'Nowhere', directory: missing, answers: ANSWERS, plan: PLAN },
          { runGit: fakeGit([]) },
        ),
      ).rejects.toBeInstanceOf(ValidationError)

      const folder = chosenFolder()
      await expect(
        scaffoldWorkspace(
          db,
          { userId: user.id, name: 'Wrong group', directory: folder, groupId: randomUUID(), answers: ANSWERS, plan: PLAN },
          { runGit: fakeGit([]) },
        ),
      ).rejects.toBeInstanceOf(NotFoundError)
      expect(readdirSync(folder)).toEqual([])
    })
  })
})
