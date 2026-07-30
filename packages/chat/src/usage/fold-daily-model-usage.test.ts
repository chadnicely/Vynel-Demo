import { describe, it, expect } from 'vitest'
import {
  foldDailyModelUsage,
  localDayKey,
  sinceForDayWindow,
} from './fold-daily-model-usage.js'
import type { AssistantUsageRow } from '../repositories/chat-usage.js'

// Local-time Date constructors keep every assertion timezone-independent —
// the fold groups by LOCAL day, so local inputs pin local outputs.
function usageRow(overrides: Partial<AssistantUsageRow>): AssistantUsageRow {
  return {
    createdAt: new Date(2026, 5, 10, 12, 0),
    model: 'claude-opus-4-8',
    providerId: 'claude',
    inputTokens: 100,
    outputTokens: 50,
    ...overrides,
  }
}

describe('localDayKey', () => {
  it('formats the local calendar day with zero padding', () => {
    expect(localDayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})

describe('sinceForDayWindow', () => {
  it('returns the start of the local day (days - 1) days ago, so the window includes today', () => {
    const since = sinceForDayWindow(7, new Date(2026, 5, 10, 15, 30))
    expect(since).toEqual(new Date(2026, 5, 4))
  })

  it('a one-day window starts at the start of today', () => {
    expect(sinceForDayWindow(1, new Date(2026, 5, 10, 15, 30))).toEqual(new Date(2026, 5, 10))
  })
})

describe('foldDailyModelUsage', () => {
  it('sums tokens and message counts per (day, provider, model) bucket', () => {
    const folded = foldDailyModelUsage([
      usageRow({ createdAt: new Date(2026, 5, 10, 9, 0), inputTokens: 100, outputTokens: 40 }),
      usageRow({ createdAt: new Date(2026, 5, 10, 18, 0), inputTokens: 200, outputTokens: 60 }),
      usageRow({
        createdAt: new Date(2026, 5, 10, 12, 0),
        model: 'claude-sonnet-5',
        inputTokens: 10,
        outputTokens: 5,
      }),
    ])
    expect(folded).toEqual([
      {
        day: '2026-06-10',
        model: 'claude-opus-4-8',
        providerId: 'claude',
        inputTokens: 300,
        outputTokens: 100,
        assistantMessageCount: 2,
      },
      {
        day: '2026-06-10',
        model: 'claude-sonnet-5',
        providerId: 'claude',
        inputTokens: 10,
        outputTokens: 5,
        assistantMessageCount: 1,
      },
    ])
  })

  it('splits buckets on the local midnight boundary', () => {
    const folded = foldDailyModelUsage([
      usageRow({ createdAt: new Date(2026, 5, 1, 23, 30) }),
      usageRow({ createdAt: new Date(2026, 5, 2, 0, 30) }),
    ])
    expect(folded.map((bucket) => bucket.day)).toEqual(['2026-06-01', '2026-06-02'])
  })

  it('keeps sessions without a captured model in their own null-model bucket', () => {
    const folded = foldDailyModelUsage([
      usageRow({ model: null }),
      usageRow({ model: null }),
      usageRow({}),
    ])
    const nullBucket = folded.find((bucket) => bucket.model === null)
    expect(nullBucket?.assistantMessageCount).toBe(2)
  })

  it('treats null token fields as zero without dropping the message count', () => {
    const folded = foldDailyModelUsage([usageRow({ inputTokens: null, outputTokens: null })])
    expect(folded).toEqual([
      {
        day: '2026-06-10',
        model: 'claude-opus-4-8',
        providerId: 'claude',
        inputTokens: 0,
        outputTokens: 0,
        assistantMessageCount: 1,
      },
    ])
  })

  it('sorts by day, then provider, then model', () => {
    const folded = foldDailyModelUsage([
      usageRow({ createdAt: new Date(2026, 5, 11), model: 'claude-sonnet-5' }),
      usageRow({ createdAt: new Date(2026, 5, 11), model: 'claude-opus-4-8' }),
      usageRow({ createdAt: new Date(2026, 5, 10) }),
    ])
    expect(folded.map((bucket) => `${bucket.day} ${bucket.model}`)).toEqual([
      '2026-06-10 claude-opus-4-8',
      '2026-06-11 claude-opus-4-8',
      '2026-06-11 claude-sonnet-5',
    ])
  })
})
