// Zod request schemas for the `skills` routes. Per
// `coding-standard.md` "Zod schemas" — XxxSchema suffix;
// API-internal (single consumer = apps/web) lives here under the
// route folder. Promote to `@vynel/contracts/skills/*` on the
// SECOND consumer per `contracts-exports-map`.
//
// Spec: blueprint §6.1.

import { z } from 'zod'

export const SkillScopeSchema = z.enum(['user', 'workspace'])

// JSON-encodable scalar — settings that come in over the wire.
const ScalarSchema = z.union([z.string(), z.number(), z.boolean()])

export const InstallSkillRequestSchema = z.object({
  skillId: z.string().min(1).max(120),
  scope: SkillScopeSchema,
  initialSettings: z.record(z.string(), ScalarSchema).optional(),
})

export const UpdateSkillSettingsRequestSchema = z.object({
  newSettings: z.record(z.string(), ScalarSchema),
})

export const InstalledSkillIdParamSchema = z.object({
  installedSkillId: z.string().min(1),
})

// ── Response schemas ────────────────────────────────────────────────
// The serialized shapes each route returns — mirrors `serializers.ts`
// exactly (field-for-field). `resolver()` wires these into
// `describeRoute` responses so the OpenAPI spec — and therefore the
// generated SDK return types — are real, not `never`.

const SkillCategorySchema = z.enum([
  'email',
  'documents',
  'calendar',
  'files',
  'research',
  'notes',
  'context',
  'creative',
  'communication',
])

const InstalledFromSourceSchema = z.enum(['verified-catalog', 'marketplace', 'external'])

const InstallHealthSchema = z.enum([
  'healthy',
  'missing-on-disk',
  'mcp-config-drift',
  'failed-install',
])

const SkillSettingTypeSchema = z.enum(['string', 'number', 'boolean', 'string-enum'])

const SkillSettingDescriptorSchema = z.object({
  settingKey: z.string(),
  displayLabel: z.string(),
  description: z.string(),
  type: SkillSettingTypeSchema,
  defaultValue: ScalarSchema,
  enumValues: z.array(z.string()).optional(),
  validationConstraints: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
      minLength: z.number().optional(),
      maxLength: z.number().optional(),
    })
    .optional(),
})

export const VerifiedSkillSchema = z.object({
  skillId: z.string(),
  displayName: z.string(),
  oneLineDescription: z.string(),
  category: SkillCategorySchema,
  iconName: z.string(),
  version: z.string(),
  recommendedScope: SkillScopeSchema,
  isSystemInstalled: z.boolean(),
  settingsSchema: z.array(SkillSettingDescriptorSchema),
})

export const InstalledSkillRowSchema = z.object({
  id: z.string(),
  skillId: z.string(),
  scope: SkillScopeSchema,
  workspaceId: z.string().nullable(),
  installedFromSource: InstalledFromSourceSchema,
  versionInstalled: z.string(),
  installHealth: InstallHealthSchema,
  installHealthMessage: z.string().nullable(),
  installedAt: z.string(),
  updatedAt: z.string(),
})

// The bare merged-settings record `PATCH .../settings` returns —
// defaults merged with per-installation overrides (no envelope).
export const ResolvedSkillSettingsSchema = z.record(z.string(), ScalarSchema)

export const InstalledSkillWithDefinitionSchema = InstalledSkillRowSchema.extend({
  definition: VerifiedSkillSchema.nullable(),
  resolvedSettings: ResolvedSkillSettingsSchema,
})

export const ListAvailableSkillsResponseSchema = z.array(VerifiedSkillSchema)

export const ListInstalledSkillsResponseSchema = z.array(InstalledSkillWithDefinitionSchema)

export const SynchronizeSkillsResponseSchema = z.object({
  healthyCount: z.number(),
  missingOnDiskCount: z.number(),
  externalDiscoveredCount: z.number(),
})
