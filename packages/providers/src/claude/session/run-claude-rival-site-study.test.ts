// Tests for `runClaudeRivalSiteStudy` — the wizard's rival-site read: one
// toolless dispatch on the capable model, JSON out, null on any failure.

import { describe, expect, it, vi } from 'vitest'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))

import { query } from '@anthropic-ai/claude-agent-sdk'
import { runClaudeRivalSiteStudy } from './run-claude-rival-site-study.js'
import {
  FAKE_CLAUDE_SESSION_ID,
  createFakeClaudeQuery,
  fakeSystemInitStep,
  type FakeClaudeQueryStep,
} from '../../test-support/fake-claude-query.js'
import type { RivalSiteStudyInput } from '../../shared/workspace-plan.js'

const mockQuery = vi.mocked(query)

const BASE: RivalSiteStudyInput = {
  site: 'opentable.com',
  idea: 'A place where my regulars can book a table.',
  workspacePath: '/work/demo',
}

const GOOD_REPLY = JSON.stringify({
  whatTheyDo: ['A search box at the top of every page', 'Email confirmation the moment you finish'],
  leaveOut: ['The sales pitch — your people already know who you are'],
  magic: [{ title: 'Done in one screen', why: 'Pick, confirm, finished.' }],
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

describe('runClaudeRivalSiteStudy', () => {
  it('returns the parsed study; dispatches fresh, ephemeral, toolless, on the capable model', async () => {
    mockQuery.mockImplementation(
      createFakeClaudeQuery([fakeSystemInitStep(), resultStep(GOOD_REPLY)]),
    )

    const study = await runClaudeRivalSiteStudy(BASE)
    expect(study?.whatTheyDo).toHaveLength(2)
    expect(study?.leaveOut).toHaveLength(1)
    expect(study?.magic).toEqual([{ title: 'Done in one screen', why: 'Pick, confirm, finished.' }])

    const queryArg = mockQuery.mock.calls.at(-1)?.[0]
    expect(queryArg?.options?.resume).toBeUndefined()
    expect(queryArg?.options?.persistSession).toBe(false)
    expect(queryArg?.options?.maxTurns).toBe(1)
    expect(queryArg?.options?.tools).toEqual([])
    // The user's own folder is the cwd — never the global space.
    expect(queryArg?.options?.cwd).toBe('/work/demo')
    // Plan quality is the product — the capable model, not the cheap one.
    expect(queryArg?.options?.model).toBe('claude-sonnet-5')
    // The site + idea ride the prompt; the honesty rule is in it verbatim.
    const prompt = queryArg?.prompt as string
    expect(prompt).toContain('opentable.com')
    expect(prompt).toContain(BASE.idea)
    expect(prompt).toContain('own knowledge')
  })

  it('drops junk magic entries but keeps the study', async () => {
    const reply = JSON.stringify({
      whatTheyDo: ['One good line'],
      leaveOut: [],
      magic: [{ title: 'No why' }, { title: 'Good', why: 'Because.' }],
    })
    mockQuery.mockImplementation(createFakeClaudeQuery([fakeSystemInitStep(), resultStep(reply)]))

    const study = await runClaudeRivalSiteStudy(BASE)
    expect(study?.magic).toEqual([{ title: 'Good', why: 'Because.' }])
  })

  it('returns null when the feature list is empty — no half-empty pretence', async () => {
    const reply = JSON.stringify({
      whatTheyDo: [],
      leaveOut: ['x'],
      magic: [],
    })
    mockQuery.mockImplementation(createFakeClaudeQuery([fakeSystemInitStep(), resultStep(reply)]))
    expect(await runClaudeRivalSiteStudy(BASE)).toBeNull()
  })

  it('returns null on an unparseable reply and on a thrown dispatch', async () => {
    mockQuery.mockImplementation(
      createFakeClaudeQuery([fakeSystemInitStep(), resultStep('not json')]),
    )
    expect(await runClaudeRivalSiteStudy(BASE)).toBeNull()

    mockQuery.mockImplementation(() => {
      throw new Error('boom')
    })
    expect(await runClaudeRivalSiteStudy(BASE)).toBeNull()
  })
})
