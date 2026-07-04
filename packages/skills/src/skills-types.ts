// Domain-only types for the `skills` leaf. See
// `docs/blueprints/skills/coding.md §3` + blueprint §3.
//
// `StructuralLogger` is owned by `@vynel/logger` (type-only — pino's
// runtime never reaches the leaf). Row types re-export from the package's
// repositories for consumer convenience. `ResolvedSkillSettings` is
// the merged-defaults-and-overrides type the installer + template
// renderer consume.

export type { StructuralLogger } from '@vynel/logger'

export type {
  InstalledSkillRow,
  NewInstalledSkillRow,
  SkillScope,
  InstalledFromSource,
  InstallHealth,
  SkillSettingRow,
  NewSkillSettingRow,
} from './repositories/index.js'

/**
 * The settings merge — the catalog's default for each
 * `settingsSchema` entry, then any per-installation override from
 * `skill_settings`. Output of `resolveSkillSettings`. Consumed by
 * the template renderer + the routes that surface "current
 * settings."
 */
export type ResolvedSkillSettings = Record<string, string | number | boolean>
