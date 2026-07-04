// Unit tests for `validateSettingValue`. Pure function.

import { describe, expect, it } from 'vitest'
import { ValidationError } from '@vynel/errors'
import { validateSettingValue } from './validate-setting-value.js'
import type { SkillSettingSchema } from '@vynel/contracts/skills/verified-skills/verified-skill-definition'

const stringSchema: SkillSettingSchema = {
  settingKey: 'signOff',
  displayLabel: 'Sign-off',
  description: '',
  type: 'string',
  defaultValue: 'Best,',
  validationConstraints: { minLength: 1, maxLength: 200 },
}

const numberSchema: SkillSettingSchema = {
  settingKey: 'limit',
  displayLabel: 'Limit',
  description: '',
  type: 'number',
  defaultValue: 100,
  validationConstraints: { min: 1, max: 1000 },
}

const booleanSchema: SkillSettingSchema = {
  settingKey: 'enabled',
  displayLabel: 'Enabled',
  description: '',
  type: 'boolean',
  defaultValue: false,
}

const enumSchema: SkillSettingSchema = {
  settingKey: 'tone',
  displayLabel: 'Tone',
  description: '',
  type: 'string-enum',
  defaultValue: 'professional',
  enumValues: ['professional', 'casual', 'warm'] as const,
}

describe('validateSettingValue', () => {
  describe('string type', () => {
    it('accepts a valid string within length bounds', () => {
      expect(() => validateSettingValue(stringSchema, 'Best,')).not.toThrow()
    })
    it('rejects a non-string', () => {
      expect(() => validateSettingValue(stringSchema, 42)).toThrow(ValidationError)
    })
    it('rejects empty string when minLength=1', () => {
      expect(() => validateSettingValue(stringSchema, '')).toThrow(/at least 1/)
    })
    it('rejects a string over maxLength', () => {
      expect(() => validateSettingValue(stringSchema, 'a'.repeat(201))).toThrow(/at most 200/)
    })
    it('accepts when no constraints are declared', () => {
      // `exactOptionalPropertyTypes: true` — omit the optional field
      // rather than passing `undefined`.
      const unconstrained: SkillSettingSchema = {
        settingKey: stringSchema.settingKey,
        displayLabel: stringSchema.displayLabel,
        description: stringSchema.description,
        type: stringSchema.type,
        defaultValue: stringSchema.defaultValue,
      }
      expect(() => validateSettingValue(unconstrained, '')).not.toThrow()
    })
  })

  describe('number type', () => {
    it('accepts a valid number within bounds', () => {
      expect(() => validateSettingValue(numberSchema, 50)).not.toThrow()
    })
    it('rejects a non-number', () => {
      expect(() => validateSettingValue(numberSchema, '50')).toThrow(ValidationError)
    })
    it('rejects NaN', () => {
      expect(() => validateSettingValue(numberSchema, Number.NaN)).toThrow(/must be a number/)
    })
    it('rejects below min', () => {
      expect(() => validateSettingValue(numberSchema, 0)).toThrow(/≥ 1/)
    })
    it('rejects above max', () => {
      expect(() => validateSettingValue(numberSchema, 1001)).toThrow(/≤ 1000/)
    })
  })

  describe('boolean type', () => {
    it('accepts true/false', () => {
      expect(() => validateSettingValue(booleanSchema, true)).not.toThrow()
      expect(() => validateSettingValue(booleanSchema, false)).not.toThrow()
    })
    it('rejects a non-boolean', () => {
      expect(() => validateSettingValue(booleanSchema, 'true')).toThrow(ValidationError)
    })
  })

  describe('string-enum type', () => {
    it('accepts a value in enumValues', () => {
      expect(() => validateSettingValue(enumSchema, 'warm')).not.toThrow()
    })
    it('rejects a value not in enumValues', () => {
      expect(() => validateSettingValue(enumSchema, 'angry')).toThrow(
        /one of: professional, casual, warm/,
      )
    })
    it('rejects a non-string', () => {
      expect(() => validateSettingValue(enumSchema, 42)).toThrow(/must be a string/)
    })
  })
})
