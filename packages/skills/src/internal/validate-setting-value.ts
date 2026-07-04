// Pure validator for a single setting value against its catalog
// schema. Throws `ValidationError` on mismatch (caller wraps in
// route-error semantics per `error-handling.md` "Layering").
//
// Type checks:
//   - 'string':       value must be string + optional minLength / maxLength
//   - 'number':       value must be number + optional min / max
//   - 'boolean':      value must be boolean
//   - 'string-enum':  value must be string AND in `enumValues`
//
// No I/O. Pure function; thrown errors propagate to the core op's
// caller per the layering rule.

import { ValidationError } from '@vynel/errors'
import type { SkillSettingSchema } from '@vynel/contracts/skills/verified-skills/verified-skill-definition'

export function validateSettingValue(schema: SkillSettingSchema, value: unknown): void {
  switch (schema.type) {
    case 'string': {
      if (typeof value !== 'string') {
        throw new ValidationError(`Setting ${schema.settingKey} must be a string`)
      }
      const constraints = schema.validationConstraints
      if (constraints?.minLength !== undefined && value.length < constraints.minLength) {
        throw new ValidationError(
          `Setting ${schema.settingKey} must be at least ${constraints.minLength} characters`,
        )
      }
      if (constraints?.maxLength !== undefined && value.length > constraints.maxLength) {
        throw new ValidationError(
          `Setting ${schema.settingKey} must be at most ${constraints.maxLength} characters`,
        )
      }
      return
    }
    case 'number': {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new ValidationError(`Setting ${schema.settingKey} must be a number`)
      }
      const constraints = schema.validationConstraints
      if (constraints?.min !== undefined && value < constraints.min) {
        throw new ValidationError(`Setting ${schema.settingKey} must be ≥ ${constraints.min}`)
      }
      if (constraints?.max !== undefined && value > constraints.max) {
        throw new ValidationError(`Setting ${schema.settingKey} must be ≤ ${constraints.max}`)
      }
      return
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        throw new ValidationError(`Setting ${schema.settingKey} must be a boolean`)
      }
      return
    }
    case 'string-enum': {
      if (typeof value !== 'string') {
        throw new ValidationError(`Setting ${schema.settingKey} must be a string`)
      }
      if (!schema.enumValues || !schema.enumValues.includes(value)) {
        const allowed = schema.enumValues ? schema.enumValues.join(', ') : '(none)'
        throw new ValidationError(`Setting ${schema.settingKey} must be one of: ${allowed}`)
      }
      return
    }
  }
}
