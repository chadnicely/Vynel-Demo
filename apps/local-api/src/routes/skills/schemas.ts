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
