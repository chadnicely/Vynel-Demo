// Unit tests for `resolveSkillSettings`. Pure function — no
// fixture DB needed. Per coding.md §8 + blueprint §11.4.

import { describe, expect, it } from 'vitest'
import { resolveSkillSettings } from './resolve-skill-settings.js'
import type { VerifiedSkillDefinition } from '@vynel/contracts/skills/verified-skills/verified-skill-definition'

function makeDefinition(): VerifiedSkillDefinition {
  return {
    skillId: 'email-drafter',
    displayName: 'Email Drafter',
    oneLineDescription: 'test',
    category: 'email',
    iconName: 'mail',
    version: '1.0.0',
    recommendedScope: 'user',
    isSystemInstalled: false,
    skillMarkdownTemplate: '',
    requiredMcpServers: [],
    settingsSchema: [
      {
        settingKey: 'defaultSignOff',
        displayLabel: 'Default sign-off',
        description: '',
        type: 'string',
        defaultValue: 'Best,',
      },
      {
        settingKey: 'tonePreference',
        displayLabel: 'Tone',
        description: '',
        type: 'string-enum',
        defaultValue: 'professional',
        enumValues: ['professional', 'casual', 'warm'] as const,
      },
      {
        settingKey: 'wordCountTarget',
        displayLabel: 'Target',
        description: '',
        type: 'number',
        defaultValue: 200,
      },
    ],
  }
}

function makeRow(key: string, encoded: string) {
  return {
    installedSkillId: 'x',
    settingKey: key,
    settingValue: encoded,
    updatedAt: new Date(),
  }
}

describe('resolveSkillSettings', () => {
  it('returns the catalog defaults when no stored values exist', () => {
    const resolved = resolveSkillSettings(makeDefinition(), [])
    expect(resolved).toEqual({
      defaultSignOff: 'Best,',
      tonePreference: 'professional',
      wordCountTarget: 200,
    })
  })

  it('overrides defaults with stored values', () => {
    const resolved = resolveSkillSettings(makeDefinition(), [
      makeRow('defaultSignOff', JSON.stringify('Cheers,')),
      makeRow('tonePreference', JSON.stringify('warm')),
    ])
    expect(resolved.defaultSignOff).toBe('Cheers,')
    expect(resolved.tonePreference).toBe('warm')
    expect(resolved.wordCountTarget).toBe(200) // not overridden — default stays
  })

  it('falls back to default when the stored value is malformed JSON', () => {
    const resolved = resolveSkillSettings(makeDefinition(), [
      makeRow('defaultSignOff', '{not json'),
    ])
    expect(resolved.defaultSignOff).toBe('Best,')
  })

  it('falls back to default when the stored value is a non-scalar (object)', () => {
    const resolved = resolveSkillSettings(makeDefinition(), [
      makeRow('defaultSignOff', JSON.stringify({ nested: 'no' })),
    ])
    expect(resolved.defaultSignOff).toBe('Best,')
  })

  it('falls back to default when the stored value is JSON null', () => {
    const resolved = resolveSkillSettings(makeDefinition(), [makeRow('defaultSignOff', 'null')])
    expect(resolved.defaultSignOff).toBe('Best,')
  })

  it('ignores stored values whose key is not in the schema', () => {
    const resolved = resolveSkillSettings(makeDefinition(), [
      makeRow('unknownKey', JSON.stringify('orphan')),
    ])
    expect(resolved).not.toHaveProperty('unknownKey')
    expect(resolved.defaultSignOff).toBe('Best,')
  })

  it('roundtrips number and boolean scalars', () => {
    const resolved = resolveSkillSettings(makeDefinition(), [
      makeRow('wordCountTarget', JSON.stringify(500)),
    ])
    expect(resolved.wordCountTarget).toBe(500)
  })

  it('returns an empty object when the catalog defines no settings', () => {
    const def = makeDefinition()
    def.settingsSchema = []
    const resolved = resolveSkillSettings(def, [makeRow('whatever', JSON.stringify('ignored'))])
    expect(resolved).toEqual({})
  })
})
