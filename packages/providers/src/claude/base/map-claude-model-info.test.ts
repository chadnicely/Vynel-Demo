import { describe, expect, it } from 'vitest'
import { mapClaudeModelInfo } from './map-claude-model-info.js'
import type { ModelInfo } from './claude-agent-sdk.js'

function info(partial: Partial<ModelInfo> & Pick<ModelInfo, 'value'>): ModelInfo {
  return { displayName: partial.value, description: '', ...partial } as ModelInfo
}

describe('mapClaudeModelInfo', () => {
  it('maps explicit rows with labels, descriptions, and effort levels', () => {
    const mapped = mapClaudeModelInfo([
      info({
        value: 'claude-opus-5',
        displayName: 'Opus 5',
        description: 'Most capable Opus.',
        supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      }),
    ])
    expect(mapped).toEqual([
      {
        id: 'claude-opus-5',
        label: 'Opus 5',
        description: 'Most capable Opus.',
        supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      },
    ])
  })

  it('canonicalizes alias rows via resolvedModel and dedupes against explicit rows', () => {
    const mapped = mapClaudeModelInfo([
      info({ value: 'sonnet', resolvedModel: 'claude-sonnet-5', displayName: 'Sonnet (alias)' }),
      info({ value: 'claude-sonnet-5', displayName: 'Sonnet 5' }),
      info({ value: 'default', resolvedModel: 'claude-sonnet-5', displayName: 'Default' }),
    ])
    expect(mapped).toEqual([
      {
        id: 'claude-sonnet-5',
        label: 'Sonnet 5', // the explicit row's label wins
        description: null,
        supportedEffortLevels: null,
      },
    ])
  })

  it('keeps an alias-only model under its resolved wire id', () => {
    const mapped = mapClaudeModelInfo([
      info({ value: 'haiku', resolvedModel: 'claude-haiku-4-5', displayName: 'Haiku 4.5' }),
    ])
    expect(mapped.map((m) => m.id)).toEqual(['claude-haiku-4-5'])
  })

  it('drops rows that resolve to no claude wire id', () => {
    const mapped = mapClaudeModelInfo([
      info({ value: 'opusplan' }),
      info({ value: 'claude-opus-5', displayName: 'Opus 5' }),
    ])
    expect(mapped.map((m) => m.id)).toEqual(['claude-opus-5'])
  })

  it('falls back to the id when displayName is empty', () => {
    const mapped = mapClaudeModelInfo([info({ value: 'claude-opus-5', displayName: '' })])
    expect(mapped[0]?.label).toBe('claude-opus-5')
  })
})

// The REAL roster the CLI reported on 2026-08-17 — every row an alias, two of
// them pointing at one model. Pinned verbatim because first-row-wins gave
// Opus the generic pointer's label and the user read the picker as
// "Opus is missing".
describe('mapClaudeModelInfo — the live roster shape', () => {
  const LIVE_ROWS = [
    {
      value: 'default',
      resolvedModel: 'claude-opus-5[1m]',
      displayName: 'Default (recommended)',
      description: 'Opus 5 with 1M context · Best for everyday, complex tasks',
      supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    },
    {
      value: 'opus[1m]',
      resolvedModel: 'claude-opus-5[1m]',
      displayName: 'Opus (1M context)',
      description: 'Opus 5 with 1M context · Best for everyday, complex tasks',
      supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    },
    {
      value: 'claude-fable-5[1m]',
      resolvedModel: 'claude-fable-5',
      displayName: 'Fable',
      description: 'Fable 5 · Most capable',
      supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    },
    { value: 'sonnet', resolvedModel: 'claude-sonnet-5', displayName: 'Sonnet', description: '' },
    {
      value: 'haiku',
      resolvedModel: 'claude-haiku-4-5-20251001',
      displayName: 'Haiku',
      description: '',
    },
  ] as unknown as Parameters<typeof mapClaudeModelInfo>[0]

  it('names a model after a NAMED alias, never the generic `default` pointer', () => {
    const models = mapClaudeModelInfo(LIVE_ROWS)
    const opus = models.find((model) => model.id === 'claude-opus-5[1m]')
    expect(opus?.label).toBe('Opus (1M context)')
    expect(models.map((model) => model.label)).not.toContain('Default (recommended)')
  })

  it('collapses the two Opus rows into one and keeps every other model', () => {
    const models = mapClaudeModelInfo(LIVE_ROWS)
    expect(models.map((model) => model.id)).toEqual([
      'claude-opus-5[1m]',
      'claude-fable-5',
      'claude-sonnet-5',
      'claude-haiku-4-5-20251001',
    ])
  })

  it('a real wire-id row still outranks every alias', () => {
    const models = mapClaudeModelInfo([
      { value: 'opus', resolvedModel: 'claude-opus-5', displayName: 'Opus', description: '' },
      { value: 'claude-opus-5', displayName: 'Claude Opus 5', description: '' },
    ] as unknown as Parameters<typeof mapClaudeModelInfo>[0])
    expect(models[0]?.label).toBe('Claude Opus 5')
  })
})
