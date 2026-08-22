// Tests for the workspace brief — the approved plan, whole, in the message
// the user sends. Session 1's items double as the first working steps.

import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceBrief,
  type WorkspaceBriefAnswers,
  type WorkspacePlan,
} from './workspace-brief.js'

const PLAN: WorkspacePlan = {
  oneLine: 'A website where your customers can book a table.',
  build: [{ text: 'Let people book a table', source: 'your answers' }],
  remembers: ['Bookings'],
  leftOut: ['The sales pitch'],
  mvpNutshell: 'The MVP is a website…',
  goals: [{ title: 'Somewhere your people can book', bullets: ['One screen', 'On a phone'] }],
  sessions: [
    { name: 'Set the project up', items: ['Create the first page', 'Wire the stack'], mvp: true },
    { name: 'The front page', items: ['What people see first'], mvp: true },
    { name: 'Photos', items: ['Drag one in'], mvp: false },
  ],
}

function makeAnswers(overrides: Partial<WorkspaceBriefAnswers> = {}): WorkspaceBriefAnswers {
  return {
    idea: 'A place where my regulars can book a table.',
    audience: 'My customers',
    firstThing: 'Book a table',
    signIn: 'No, open to everyone',
    where: 'A website',
    remembers: ['Bookings'],
    wants: [],
    leftOut: [],
    changeRequests: [],
    goalNotes: [],
    stack: { front: 'Next.js', back: 'Next.js API routes', database: 'SQLite' },
    ...overrides,
  }
}

describe('buildWorkspaceBrief', () => {
  it('carries the plan whole: idea, stack, goals, ordered sessions, later list', () => {
    const brief = buildWorkspaceBrief({
      name: 'Front of House',
      answers: makeAnswers({
        changeRequests: ['No sign-in just to look.'],
        goalNotes: ['Goal 2 first.'],
        advancedNotes: 'pnpm, strict TypeScript',
      }),
      plan: PLAN,
      note: null,
    })

    expect(brief).toContain('Build Front of House — the MVP first.')
    expect(brief).toContain('The idea: A website where your customers can book a table.')
    expect(brief).toContain('Stack: Next.js, Next.js API routes, SQLite')
    expect(brief).toContain('Also follow: pnpm, strict TypeScript')
    expect(brief).toContain('1. Somewhere your people can book — One screen; On a phone')
    expect(brief).toContain('1. Set the project up: Create the first page; Wire the stack')
    expect(brief).toContain('2. The front page: What people see first')
    expect(brief).toContain('After the MVP (do not start these yet): Photos')
    expect(brief).toContain('- No sign-in just to look.')
    expect(brief).toContain('- Goal 2 first.')
    expect(brief).toContain("laying out session 1's items as your working steps")
  })

  it('a scaffold note rides as an honest line; a clean scaffold adds nothing', () => {
    const clean = buildWorkspaceBrief({ name: 'X', answers: makeAnswers(), plan: PLAN, note: null })
    expect(clean).not.toContain('(Note:')
    expect(clean).not.toContain('Also follow:')

    const noted = buildWorkspaceBrief({
      name: 'X',
      answers: makeAnswers(),
      plan: PLAN,
      note: 'Git is not available on this computer.',
    })
    expect(noted).toContain('(Note: Git is not available on this computer.)')
  })
})
