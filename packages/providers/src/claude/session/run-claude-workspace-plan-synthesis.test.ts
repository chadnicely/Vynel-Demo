// Tests for `runClaudeWorkspacePlanSynthesis` — the wizard's one synthesis: every
// answer in, the rateable plan out, null on failure (the wizard falls back).

import { describe, expect, it, vi } from 'vitest'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))

import { query } from '@anthropic-ai/claude-agent-sdk'
import { runClaudeWorkspacePlanSynthesis } from './run-claude-workspace-plan-synthesis.js'
import {
  FAKE_CLAUDE_SESSION_ID,
  createFakeClaudeQuery,
  fakeSystemInitStep,
  type FakeClaudeQueryStep,
} from '../../test-support/fake-claude-query.js'
import type { WorkspacePlanInput } from '../../shared/workspace-plan.js'

const mockQuery = vi.mocked(query)

const BASE: WorkspacePlanInput = {
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
  workspacePath: '/work/demo',
}

const GOOD_REPLY = JSON.stringify({
  oneLine: 'A website where your customers can book a table.',
  build: [{ text: 'Let people book a table', source: 'your answers' }],
  remembers: ['Bookings', 'People'],
  leftOut: ['The sales pitch'],
  mvpNutshell: 'The MVP is a website where your customers can book a table.',
  goals: [
    {
      title: 'Somewhere your people can book',
      bullets: ['One screen, start to finish'],
    },
  ],
  sessions: [
    {
      name: 'Make the folder',
      items: ['Create the project folder'],
      mvp: true,
    },
    { name: 'Photos', items: ['Drag a photo in'], mvp: false },
  ],
})

function resultStep(result: string): FakeClaudeQueryStep {
  return {
    kind: 'emit',
    message: {
      type: 'result',
      subtype: 'success',
      session_id: FAKE_CLAUDE_SESSION_ID,
      result,
      usage: {},
    },
  }
}

function withReply(reply: string): void {
  mockQuery.mockImplementation(createFakeClaudeQuery([fakeSystemInitStep(), resultStep(reply)]))
}

describe('runClaudeWorkspacePlanSynthesis', () => {
  it('returns the parsed plan; dispatches fresh, ephemeral, toolless, on the capable model', async () => {
    withReply(GOOD_REPLY)

    const plan = await runClaudeWorkspacePlanSynthesis(BASE)
    expect(plan?.oneLine).toBe('A website where your customers can book a table.')
    expect(plan?.build).toEqual([{ text: 'Let people book a table', source: 'your answers' }])
    expect(plan?.sessions).toEqual([
      {
        name: 'Make the folder',
        items: ['Create the project folder'],
        mvp: true,
      },
      { name: 'Photos', items: ['Drag a photo in'], mvp: false },
    ])

    const queryArg = mockQuery.mock.calls.at(-1)?.[0]
    expect(queryArg?.options?.resume).toBeUndefined()
    expect(queryArg?.options?.persistSession).toBe(false)
    expect(queryArg?.options?.maxTurns).toBe(1)
    expect(queryArg?.options?.tools).toEqual([])
    expect(queryArg?.options?.cwd).toBe('/work/demo')
    expect(queryArg?.options?.model).toBe('claude-sonnet-5')
    // Every answer rides the prompt — including the wish list with its
    // source and the change requests the model must fold in.
    const prompt = queryArg?.prompt as string
    expect(prompt).toContain(BASE.idea)
    expect(prompt).toContain('It remembers them (from: opentable.com)')
    expect(prompt).toContain('Nobody should have to sign in just to look.')
    expect(prompt).toContain('Next.js, Next.js API routes, SQLite')
  })

  it('a missing mvp flag on a session defaults to true', async () => {
    withReply(
      JSON.stringify({
        ...JSON.parse(GOOD_REPLY),
        sessions: [{ name: 'Make the folder', items: ['x'] }],
      }),
    )
    const plan = await runClaudeWorkspacePlanSynthesis(BASE)
    expect(plan?.sessions[0]?.mvp).toBe(true)
  })

  it('an unsourced build line defaults its source to "your answers"', async () => {
    withReply(
      JSON.stringify({
        ...JSON.parse(GOOD_REPLY),
        build: [{ text: 'Something' }],
      }),
    )
    const plan = await runClaudeWorkspacePlanSynthesis(BASE)
    expect(plan?.build).toEqual([{ text: 'Something', source: 'your answers' }])
  })

  it('falls back whole when a load-bearing piece is missing', async () => {
    withReply(JSON.stringify({ ...JSON.parse(GOOD_REPLY), sessions: [] }))
    expect(await runClaudeWorkspacePlanSynthesis(BASE)).toBeNull()

    withReply(JSON.stringify({ ...JSON.parse(GOOD_REPLY), oneLine: '' }))
    expect(await runClaudeWorkspacePlanSynthesis(BASE)).toBeNull()
  })

  it('returns null on an unparseable reply', async () => {
    withReply('nope')
    expect(await runClaudeWorkspacePlanSynthesis(BASE)).toBeNull()
  })
})
