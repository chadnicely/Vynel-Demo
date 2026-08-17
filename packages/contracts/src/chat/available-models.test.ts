import { describe, expect, it } from 'vitest'
import {
  availableChatModelsFloor,
  formatContextWindow,
  groupAvailableModels,
  parseClaudeModelId,
  selectEffortOptionsForModel,
  toAvailableChatModels,
  type AvailableChatModel,
} from './available-models.js'

function model(id: string, label = id): AvailableChatModel {
  return {
    id,
    label,
    description: null,
    supportedEffortLevels: null,
    contextWindowTokens: 200_000,
  }
}

describe('parseClaudeModelId', () => {
  it('parses modern ids (version after the family)', () => {
    expect(parseClaudeModelId('claude-opus-4-8')).toEqual({ family: 'opus', version: 408 })
    expect(parseClaudeModelId('claude-opus-5')).toEqual({ family: 'opus', version: 500 })
    expect(parseClaudeModelId('claude-fable-5')).toEqual({ family: 'fable', version: 500 })
  })

  it('ignores an 8-digit date suffix', () => {
    expect(parseClaudeModelId('claude-haiku-4-5-20251001')).toEqual({
      family: 'haiku',
      version: 405,
    })
  })

  it('parses legacy ids (version before the family)', () => {
    expect(parseClaudeModelId('claude-3-5-sonnet-20241022')).toEqual({
      family: 'sonnet',
      version: 305,
    })
  })

  it('unknown families parse to null', () => {
    expect(parseClaudeModelId('gpt-4o')).toEqual({ family: null, version: null })
  })
})

describe('groupAvailableModels', () => {
  it('puts the newest of each family in current, older behind more, tier-ordered', () => {
    const grouped = groupAvailableModels([
      model('claude-sonnet-4-6'),
      model('claude-opus-4-8'),
      model('claude-opus-5'),
      model('claude-haiku-4-5'),
      model('claude-fable-5'),
      model('claude-sonnet-5'),
      model('claude-3-5-sonnet-20241022'),
    ])

    expect(grouped.current.map((m) => m.id)).toEqual([
      'claude-fable-5',
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-haiku-4-5',
    ])
    expect(grouped.more.map((m) => m.id)).toEqual([
      'claude-opus-4-8',
      'claude-sonnet-4-6',
      'claude-3-5-sonnet-20241022',
    ])
  })

  it('unrecognized ids land in more, after the known families', () => {
    const grouped = groupAvailableModels([model('mystery-model'), model('claude-opus-5')])
    expect(grouped.current.map((m) => m.id)).toEqual(['claude-opus-5'])
    expect(grouped.more.map((m) => m.id)).toEqual(['mystery-model'])
  })

  it('a version tie (date-suffixed twin) yields ONE current row, the twin in more', () => {
    const grouped = groupAvailableModels([
      model('claude-haiku-4-5'),
      model('claude-haiku-4-5-20251001'),
    ])
    expect(grouped.current).toHaveLength(1)
    expect(grouped.more).toHaveLength(1)
  })
})

describe('formatContextWindow', () => {
  it('formats the two real tiers', () => {
    expect(formatContextWindow(1_000_000)).toBe('1M')
    expect(formatContextWindow(200_000)).toBe('200K')
  })
})

describe('floor + derivation', () => {
  it('the floor carries derived context windows', () => {
    const floor = availableChatModelsFloor()
    expect(floor.find((m) => m.id === 'claude-opus-5')?.contextWindowTokens).toBe(1_000_000)
    expect(floor.find((m) => m.id === 'claude-haiku-4-5')?.contextWindowTokens).toBe(200_000)
  })

  it('toAvailableChatModels derives context at read time', () => {
    const [derived] = toAvailableChatModels([
      { id: 'claude-sonnet-5', label: 'Sonnet 5', description: null, supportedEffortLevels: null },
    ])
    expect(derived?.contextWindowTokens).toBe(1_000_000)
  })
})

describe('selectEffortOptionsForModel', () => {
  const OPTIONS = [
    { id: 'low' as const, label: 'Low' },
    { id: 'medium' as const, label: 'Medium' },
    { id: 'high' as const, label: 'High' },
    { id: 'xhigh' as const, label: 'Extra' },
    { id: 'max' as const, label: 'Max' },
  ]

  it('offers only what the engine says the model supports', () => {
    const filtered = selectEffortOptionsForModel(OPTIONS, {
      supportedEffortLevels: ['low', 'medium', 'high'],
    })
    expect(filtered.map((option) => option.id)).toEqual(['low', 'medium', 'high'])
  })

  it('keeps the canonical order, not the enginesʼ', () => {
    const filtered = selectEffortOptionsForModel(OPTIONS, {
      supportedEffortLevels: ['max', 'low'],
    })
    expect(filtered.map((option) => option.id)).toEqual(['low', 'max'])
  })

  it('offers everything when the engine said nothing (and for the static floor)', () => {
    expect(selectEffortOptionsForModel(OPTIONS, { supportedEffortLevels: null })).toHaveLength(5)
    expect(selectEffortOptionsForModel(OPTIONS, undefined)).toHaveLength(5)
    expect(selectEffortOptionsForModel(OPTIONS, { supportedEffortLevels: [] })).toHaveLength(5)
  })

  it('never renders an EMPTY picker on an answer that matches nothing', () => {
    const filtered = selectEffortOptionsForModel(OPTIONS, {
      supportedEffortLevels: ['ludicrous' as never],
    })
    expect(filtered).toHaveLength(5)
  })
})
