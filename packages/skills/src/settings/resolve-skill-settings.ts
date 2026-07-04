// Pure function that merges a skill's catalog defaults with its
// per-installation stored settings. Output feeds the template
// renderer (`renderSkillMarkdownTemplate`) and the route response
// (`resolvedSettings` field).
//
// **No I/O.** Callers fetch `storedSettings` from the
// `skill_settings` table separately via the repository, then call
// this pure function. Per coding.md §1.4 (Settings resolution is
// pure) — keeps the resolver trivially testable and lets callers
// cache settings they already have.
//
// Malformed stored values (JSON.parse throws) fall through to the
// catalog default. Documented behavior per blueprint §7.

import type { VerifiedSkillDefinition } from '@vynel/contracts/skills/verified-skills/verified-skill-definition'
import type { SkillSettingRow } from '../repositories/index.js'

export type ResolvedSkillSettings = Record<string, string | number | boolean>

export function resolveSkillSettings(
  definition: VerifiedSkillDefinition,
  storedSettings: readonly SkillSettingRow[],
): ResolvedSkillSettings {
  const resolved: ResolvedSkillSettings = {}
  const storedByKey = new Map(storedSettings.map((s) => [s.settingKey, s.settingValue]))

  for (const schema of definition.settingsSchema) {
    const stored = storedByKey.get(schema.settingKey)
    if (stored !== undefined) {
      try {
        const decoded = JSON.parse(stored) as unknown
        if (
          typeof decoded === 'string' ||
          typeof decoded === 'number' ||
          typeof decoded === 'boolean'
        ) {
          resolved[schema.settingKey] = decoded
          continue
        }
        // Decoded to a non-scalar (object/array/null) — type-incompatible
        // with the schema. Fall through to default.
      } catch {
        // JSON.parse threw — malformed stored value. Fall through.
      }
    }
    resolved[schema.settingKey] = schema.defaultValue
  }

  return resolved
}
