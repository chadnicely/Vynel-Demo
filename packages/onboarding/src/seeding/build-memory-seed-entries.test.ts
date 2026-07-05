import { describe, it, expect } from 'vitest'
import { buildMemorySeedEntries } from './build-memory-seed-entries.js'

describe('buildMemorySeedEntries', () => {
  it('maps the about-you + workspace-context answers to two memory entries', () => {
    const entries = buildMemorySeedEntries({
      userId: 'u1',
      workspaceId: 'w1',
      answers: {
        aboutYouParagraph: 'I run a small bakery.',
        workspaceContextAnswer: 'Track supplier emails and invoices.',
      },
    })

    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      userId: 'u1',
      workspaceId: 'w1',
      kind: 'note',
      body: 'I run a small bakery.',
      category: 'user',
      createdSource: 'onboarding-seed',
    })
    expect(entries[1]).toMatchObject({
      body: 'Track supplier emails and invoices.',
      category: 'memory',
      createdSource: 'onboarding-seed',
    })
  })

  it('adds a third (preference) entry when a working-style answer is given', () => {
    const entries = buildMemorySeedEntries({
      userId: 'u1',
      workspaceId: 'w1',
      answers: {
        aboutYouParagraph: 'a',
        workspaceContextAnswer: 'b',
        workingStyleAnswer: 'Keep replies short and direct.',
      },
    })

    expect(entries).toHaveLength(3)
    expect(entries[2]).toMatchObject({
      kind: 'preference',
      body: 'Keep replies short and direct.',
      category: 'preferences',
    })
  })

  it('skips the working-style entry when it is blank', () => {
    const entries = buildMemorySeedEntries({
      userId: 'u1',
      workspaceId: 'w1',
      answers: { aboutYouParagraph: 'a', workspaceContextAnswer: 'b', workingStyleAnswer: '   ' },
    })

    expect(entries).toHaveLength(2)
  })
})
