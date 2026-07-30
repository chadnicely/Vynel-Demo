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
