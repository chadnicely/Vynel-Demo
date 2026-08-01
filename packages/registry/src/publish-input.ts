// Publish-request validation. The manifest is validated as a bounded JSON
// object but kept OPAQUE to the registry (its per-kind meaning is the
// desktop installer's concern in M4b) — so a new kind needs no hub change.

import { z } from 'zod'

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
// Semver: major.minor.patch with an optional -prerelease / +build.
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)*$/

export const PublishItemSchema = z.object({
  publisher: z.object({
    id: z.string().regex(KEBAB).max(80),
    name: z.string().min(1).max(120),
    tier: z.enum(['verified', 'anthropic-official', 'community']).default('verified'),
    url: z.string().url().max(400).nullable().optional(),
  }),
  item: z.object({
    // 'publish' is reserved: the admin portal routes /catalog/publish as its
    // own page, so an item with that id would have an unreachable detail URL.
    itemId: z
      .string()
      .regex(KEBAB)
      .max(120)
      .refine((id) => id !== 'publish', { message: "'publish' is a reserved item id." }),
    kind: z.enum(['skill', 'agent', 'mcp', 'rule', 'plugin']),
    displayName: z.string().min(1).max(120),
    oneLineDescription: z.string().min(1).max(280),
    category: z.string().min(1).max(60),
    iconName: z.string().min(1).max(60),
    recommendedScope: z.enum(['user', 'workspace', 'both']).nullable().optional(),
    // Credit-line origin (Chad 2026-08-01: every resource credits its
    // source) — the upstream repo/site the content came from.
    sourceUrl: z.string().url().max(400).nullable().optional(),
    minimumTier: z.enum(['basic', 'pro']).default('basic'),
    status: z.enum(['draft', 'published', 'yanked']).default('published'),
  }),
  version: z.object({
    version: z.string().regex(SEMVER).max(40),
    changelog: z.string().max(4000).default(''),
    // Opaque per-kind install manifest; bounded, not deeply parsed.
    manifest: z.record(z.unknown()),
    minAppVersion: z.string().max(40).nullable().optional(),
  }),
})

export type PublishItemInput = z.infer<typeof PublishItemSchema>
