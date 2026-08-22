import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
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
import { scaffoldWorkspace, type GitRunner } from './scaffold-workspace.js'

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

// The folder the user chose on screen 1.
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

// Records every git call instead of shelling out.
function fakeGit(calls: { args: string[]; cwd: string }[]): GitRunner {
  return async (args, cwd) => {
    calls.push({ args, cwd })
  }
}

describe('scaffoldWorkspace', () => {
  it('makes the folder inside the chosen one, writes the README, inits git, registers the row, stores the brief', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const parent = chosenFolder()
      const gitCalls: { args: string[]; cwd: string }[] = []

      const made = await scaffoldWorkspace(
        db,
        { userId: user.id, name: 'Front of House', parentPath: parent, answers: ANSWERS, plan: PLAN },
        { runGit: fakeGit(gitCalls) },
      )

      const expectedDir = path.join(realpathSync(parent), 'Front of House')
      expect(made.workspace.path).toBe(expectedDir)
      expect(made.workspace.name).toBe('Front of House')
      expect(made.workspace.groupId).toBeNull()
      expect(existsSync(path.join(expectedDir, '.vynel'))).toBe(true)
      expect(readFileSync(path.join(expectedDir, 'README.md'), 'utf8')).toContain(
        '- Front end: Next.js',
      )
      // Vynel's metadata never enters the project's history.
      expect(readFileSync(path.join(expectedDir, '.gitignore'), 'utf8')).toBe('.vynel/\n')

      expect(made.git).toEqual({ kind: 'initialized' })
      expect(gitCalls.map((call) => call.args[0] === '-c' ? 'commit' : call.args[0])).toEqual([
        'init',
        'add',
        'commit',
      ])
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

  it('files the row into the group and sanitizes the folder name', async () => {
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

      const made = await scaffoldWorkspace(
        db,
        {
          userId: user.id,
          name: 'Front of House: v2.',
          parentPath: parent,
          groupId: group.id,
          answers: ANSWERS,
          plan: PLAN,
        },
        { runGit: fakeGit([]) },
      )

      expect(made.workspace.groupId).toBe(group.id)
      expect(path.basename(made.workspace.path)).toBe('Front of House_ v2')
    })
  })

  it('a machine without git still gets a healthy workspace — said plainly, in the brief too', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const parent = chosenFolder()
      const warnings: string[] = []
      const noGit: GitRunner = async () => {
        throw new Error('spawn git ENOENT')
      }

      const made = await scaffoldWorkspace(
        db,
        { userId: user.id, name: 'Offline', parentPath: parent, answers: ANSWERS, plan: PLAN },
        { runGit: noGit, logger: { info: () => {}, warn: (_obj, msg) => warnings.push(msg) } },
      )

      expect(made.git.kind).toBe('skipped')
      expect(made.brief.brief).toContain("(Note: Git couldn't start a history")
      expect(warnings).toEqual(['git could not initialise the new workspace'])
      expect(findWorkspaceById(db, made.workspace.id)).not.toBeNull()
    })
  })

  it('refuses a folder that is already there, and leaves it untouched', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const parent = chosenFolder()
      mkdirSync(path.join(parent, 'Taken'))

      await expect(
        scaffoldWorkspace(
          db,
          { userId: user.id, name: 'Taken', parentPath: parent, answers: ANSWERS, plan: PLAN },
          { runGit: fakeGit([]) },
        ),
      ).rejects.toBeInstanceOf(ConflictError)
      expect(existsSync(path.join(parent, 'Taken'))).toBe(true)
      expect(listWorkspacesForUser(db, user.id)).toEqual([])
    })
  })

  it('a row clash after the folder is made rolls everything back — no folder, no row, no brief', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const parent = chosenFolder()
      // A row already claims the path the scaffold is about to make (the
      // folder itself is gone — a moved workspace), so createWorkspaceWithin's
      // dedup fires AFTER the folder exists.
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
        scaffoldWorkspace(
          db,
          { userId: user.id, name: 'Taken', parentPath: parent, answers: ANSWERS, plan: PLAN },
          { runGit: fakeGit([]) },
        ),
      ).rejects.toBeInstanceOf(ConflictError)

      expect(existsSync(path.join(parent, 'Taken'))).toBe(false)
      expect(listWorkspacesForUser(db, user.id).map((row) => row.name)).toEqual(['Ghost'])
      for (const row of listWorkspacesForUser(db, user.id)) {
        expect(findWorkspaceBriefByWorkspaceId(db, row.id)).toBeNull()
      }
    })
  })

  it('a missing chosen folder is a ValidationError; a foreign group is a NotFoundError before any folder is made', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const missing = path.join(os.tmpdir(), `vynel-missing-${randomUUID()}`)

      await expect(
        scaffoldWorkspace(
          db,
          { userId: user.id, name: 'Nowhere', parentPath: missing, answers: ANSWERS, plan: PLAN },
          { runGit: fakeGit([]) },
        ),
      ).rejects.toBeInstanceOf(ValidationError)

      const parent = chosenFolder()
      await expect(
        scaffoldWorkspace(
          db,
          {
            userId: user.id,
            name: 'Wrong group',
            parentPath: parent,
            groupId: randomUUID(),
            answers: ANSWERS,
            plan: PLAN,
          },
          { runGit: fakeGit([]) },
        ),
      ).rejects.toBeInstanceOf(NotFoundError)
      expect(readdirSync(parent)).toEqual([])
    })
  })
})
