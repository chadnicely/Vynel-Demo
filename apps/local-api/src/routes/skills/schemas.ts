// Zod request schemas for the `skills` routes. Per
// `coding-standard.md` "Zod schemas" — XxxSchema suffix;
// API-internal (single consumer = apps/web) lives here under the
// route folder. Promote to `@vynel/contracts/skills/*` on the
// SECOND consumer per `contracts-exports-map`.
//
// Spec: blueprint §6.1.

import { z } from 'zod'
import {
  MAX_SKILL_BODY_LENGTH,
  MAX_SKILL_DESCRIPTION_LENGTH,
  MAX_SKILL_FILE_PATH_LENGTH,
  MAX_SKILL_ID_LENGTH,
  MAX_SKILL_TEXT_FILE_BYTES,
} from '@vynel/skills'

export const SkillScopeSchema = z.enum(['user', 'workspace'])

// The skill-file doors address a skill by id + { scope, workspaceId? } —
// required when scope is 'workspace', ignored for 'user' (a workspace
// turn's ambient stamp may attach one); `resolveScopeTarget` decides.
const ScopeFieldsSchema = {
  scope: SkillScopeSchema,
  workspaceId: z.string().min(1).optional(),
}

export const SkillIdParamSchema = z.object({
  skillId: z.string().min(1).max(120),
})

export const SkillScopeQuerySchema = z.object(ScopeFieldsSchema)

export const CreateSkillRequestSchema = z.object({
  ...ScopeFieldsSchema,
  skillId: z.string().min(1).max(MAX_SKILL_ID_LENGTH),
  description: z.string().min(1).max(MAX_SKILL_DESCRIPTION_LENGTH),
  body: z.string().min(1).max(MAX_SKILL_BODY_LENGTH),
})

const SkillFilePathSchema = z.string().min(1).max(MAX_SKILL_FILE_PATH_LENGTH)

export const SkillFilesQuerySchema = z.object({
  ...ScopeFieldsSchema,
  /** The file to open alongside the list; SKILL.md when omitted. */
  relativePath: SkillFilePathSchema.optional(),
})

export const WriteSkillFileRequestSchema = z.object({
  ...ScopeFieldsSchema,
  relativePath: SkillFilePathSchema,
  content: z.string().max(MAX_SKILL_TEXT_FILE_BYTES),
})

export const DeleteSkillFileQuerySchema = z.object({
  ...ScopeFieldsSchema,
  relativePath: SkillFilePathSchema,
})

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

const InstalledFromSourceSchema = z.enum(['verified-catalog', 'marketplace', 'external', 'user'])

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

export const SkillFileEntrySchema = z.object({
  relativePath: z.string(),
  sizeBytes: z.number().int(),
  /** Text the editor can open; a binary asset is listed, never opened. */
  isText: z.boolean(),
})

export const SkillFilesResponseSchema = z.object({
  skillId: z.string(),
  scope: SkillScopeSchema,
  files: z.array(SkillFileEntrySchema),
  file: z.object({ relativePath: z.string(), content: z.string() }),
})

export const SynchronizeSkillsResponseSchema = z.object({
  healthyCount: z.number(),
  missingOnDiskCount: z.number(),
  externalDiscoveredCount: z.number(),
})
