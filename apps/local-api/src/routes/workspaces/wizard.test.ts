// Integration tests for the `/workspaces/wizard/...` routes. Full HTTP stack
// (route → userScoped → the provider seam). The routes read
// `c.var.aiProvider` (injected via `createApp({ aiProvider })`), so a FAKE
// provider threads through the whole stack — a real one would dispatch a
// model turn (providers route-test precedent). The recorded inputs prove
// the one thing the routes own: the user's chosen folder becomes the
// dispatch cwd, canonical and existing, and the answers pass through whole.

import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { mkdtempSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import type {
  AiAgentProvider,
  WorkspacePlan,
  WorkspacePlanInput,
  RivalSiteStudy,
  RivalSiteStudyInput,
} from '@vynel/providers'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })

const STUDY: RivalSiteStudy = {
  whatTheyDo: ['A search box at the top of every page'],
  leaveOut: ['The sales pitch — your people already know who you are'],
  magic: [{ title: 'Done in one screen', why: 'Pick, confirm, finished.' }],
}

const PLAN: WorkspacePlan = {
  oneLine: 'A website where your customers can book a table.',
  build: [{ text: 'Let people book a table', source: 'your answers' }],
  remembers: ['Bookings'],
  leftOut: ['The sales pitch'],
  mvpNutshell: 'The smallest version worth using.',
  goals: [
    {
      title: 'Somewhere your people can book',
      bullets: ['One screen, start to finish'],
    },
  ],
  sessions: [{ name: 'Set the project up', items: ['Create the first page'], mvp: true }],
}

const PLAN_ANSWERS = {
  idea: 'A place where my regulars can book a table.',
  audience: 'My customers',
  firstThing: 'Book a table for a date and time',
  signIn: 'No, open to everyone',
  where: 'A website',
  remembers: ['Bookings', 'People'],
  wants: [{ text: 'It remembers them', from: 'opentable.com' }],
  leftOut: ['The sales pitch — your people already know who you are'],
  changeRequests: ['Nobody should have to sign in just to look.'],
  goalNotes: [],
  stack: { front: 'Next.js', back: 'Next.js API routes', database: 'SQLite' },
}

type Recorded = { studies: RivalSiteStudyInput[]; plans: WorkspacePlanInput[] }

// Only the two one-shots these routes exercise are faked; the rest throw to
// signal misuse (the providers route test's makeFakeProvider shape).
function makeFakeProvider(
  recorded: Recorded,
  replies: { study: RivalSiteStudy | null; plan: WorkspacePlan | null },
): AiAgentProvider {
  const unused = (name: string) => () => {
    throw new Error(`${name} not used in workspace wizard route tests`)
  }
  return {
    providerId: 'claude' as const,
    getAuthenticationStatus: unused('getAuthenticationStatus'),
    discoverInstalledSkills: unused('discoverInstalledSkills'),
    listConfiguredMcpServers: async () => [],
    startChatSession: unused('startChatSession'),
    respondToApprovalRequest: unused('respondToApprovalRequest'),
    interruptChatSession: unused('interruptChatSession'),
    fetchPersistedSessionTranscript: unused('fetchPersistedSessionTranscript'),
    synchronizePersistedSessions: async () => [],
    getContextReport: async () => null,
    summarizeSession: async () => null,
    summarizeReport: async () => null,
    discoverModels: async () => null,
    studyRivalSite: async (input: RivalSiteStudyInput) => {
      recorded.studies.push(input)
      return replies.study
    },
    synthesizeWorkspacePlan: async (input: WorkspacePlanInput) => {
      recorded.plans.push(input)
      return replies.plan
    },
    setSessionPermissionMode: async () => false,
  } as AiAgentProvider
}

function makeChosenFolder(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'vynel-workspace-wizard-'))
}

// The one-shot reads (study / plan) now dispatch from the user's PROJECTS
// folder, resolved server-side — seed a user whose folder we control so the
// dispatch cwd is a known path.
function seedUserWithProjectsHome(
  db: Parameters<Parameters<typeof withTestDatabase>[0]>[0],
  home: string,
): void {
  const now = new Date()
  insertUser(db, {
    id: randomUUID(),
    displayName: 'Test',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    projectsDirectory: home,
    createdAt: now,
    updatedAt: now,
  })
}

function postJson(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

describe('workspace wizard routes', () => {
  describe('POST /workspaces/wizard/study-rival', () => {
    it("answers the study and dispatches from the user's projects folder", async () => {
      await withTestDatabase(async (db) => {
        const recorded: Recorded = { studies: [], plans: [] }
        const home = makeChosenFolder()
        seedUserWithProjectsHome(db, home)
        const app = createApp({
          db,
          logger: silentLogger,
          aiProvider: makeFakeProvider(recorded, { study: STUDY, plan: null }),
        })

        const res = await app.request(
          '/workspaces/wizard/study-rival',
          postJson({ site: 'opentable.com', idea: 'Book a table' }),
        )

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ study: STUDY })
        expect(recorded.studies).toHaveLength(1)
        expect(recorded.studies[0]?.site).toBe('opentable.com')
        expect(recorded.studies[0]?.idea).toBe('Book a table')
        // Dispatched from the projects folder — never a client-supplied path.
        expect(recorded.studies[0]?.workspacePath).toBe(home)
      })
    })

    it('passes a null study through — the screen says so, nothing invented', async () => {
      await withTestDatabase(async (db) => {
        const recorded: Recorded = { studies: [], plans: [] }
        const app = createApp({
          db,
          logger: silentLogger,
          aiProvider: makeFakeProvider(recorded, { study: null, plan: null }),
        })

        const res = await app.request(
          '/workspaces/wizard/study-rival',
          postJson({
            site: 'opentable.com',
            idea: 'Book a table',
            directory: makeChosenFolder(),
          }),
        )

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ study: null })
      })
    })

    it('returns 400 for a body below the floor (site too short)', async () => {
      await withTestDatabase(async (db) => {
        const recorded: Recorded = { studies: [], plans: [] }
        const app = createApp({
          db,
          logger: silentLogger,
          aiProvider: makeFakeProvider(recorded, { study: STUDY, plan: null }),
        })

        const res = await app.request(
          '/workspaces/wizard/study-rival',
          postJson({
            site: 'ab',
            idea: 'Book a table',
            directory: makeChosenFolder(),
          }),
        )

        expect(res.status).toBe(400)
        expect(recorded.studies).toHaveLength(0)
      })
    })
  })

  describe('POST /workspaces/wizard/plan', () => {
    it('answers the plan and hands every answer to the provider whole', async () => {
      await withTestDatabase(async (db) => {
        const recorded: Recorded = { studies: [], plans: [] }
        const home = makeChosenFolder()
        seedUserWithProjectsHome(db, home)
        const app = createApp({
          db,
          logger: silentLogger,
          aiProvider: makeFakeProvider(recorded, { study: null, plan: PLAN }),
        })

        const res = await app.request('/workspaces/wizard/plan', postJson(PLAN_ANSWERS))

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ plan: PLAN })
        expect(recorded.plans).toHaveLength(1)
        const received = recorded.plans[0]!
        // The cwd is the projects folder, resolved server-side, not an answer.
        expect(received.workspacePath).toBe(home)
        expect(received.wants).toEqual(PLAN_ANSWERS.wants)
        expect(received.changeRequests).toEqual(PLAN_ANSWERS.changeRequests)
        expect(received.stack).toEqual(PLAN_ANSWERS.stack)
        expect('directory' in received).toBe(false)
      })
    })

    it('passes a null plan through — the wizard falls back to its own derivation', async () => {
      await withTestDatabase(async (db) => {
        const recorded: Recorded = { studies: [], plans: [] }
        const app = createApp({
          db,
          logger: silentLogger,
          aiProvider: makeFakeProvider(recorded, { study: null, plan: null }),
        })

        const res = await app.request(
          '/workspaces/wizard/plan',
          postJson({ ...PLAN_ANSWERS, directory: makeChosenFolder() }),
        )

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ plan: null })
      })
    })

    it('returns 400 when a required answer is missing', async () => {
      await withTestDatabase(async (db) => {
        const recorded: Recorded = { studies: [], plans: [] }
        const app = createApp({
          db,
          logger: silentLogger,
          aiProvider: makeFakeProvider(recorded, { study: null, plan: PLAN }),
        })
        const { idea: _idea, ...withoutIdea } = PLAN_ANSWERS

        const res = await app.request(
          '/workspaces/wizard/plan',
          postJson({ ...withoutIdea, directory: makeChosenFolder() }),
        )

        expect(res.status).toBe(400)
        expect(recorded.plans).toHaveLength(0)
      })
    })
  })
})
