// Zod request schemas for the `agents` routes. Per `coding-standard.md`
// "Zod schemas" — XxxSchema suffix; API-internal (single consumer =
// apps/web) lives here under the route folder. Promote to
// `@vynel/contracts/agents/*` on the SECOND consumer.
//
// Plain ZodObjects (no `.refine`) so hono-openapi emits clean request
// bodies for the SDK generator; the scope ↔ workspaceId relationship is
// enforced in the handler (a ValidationError), not via a ZodEffects.

import { z } from 'zod'

export const AgentScopeSchema = z.enum(['user', 'workspace'])
export const AgentEffortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max'])

// All six SDK `PermissionMode` values are exposed: Vynel surfaces every
// option the SDK provides. The permission MODE is only what an agent
// *declares* — it is NOT the safety mechanism. Safety lives in Vynel's
// BEHAVIOR layer: the `canUseTool` gate + PreToolUse backstop (which card
// the irreversible floor in ask mode and the unattended default — the
// SESSION's mode governs the whole turn, subagents included, 2026-07-30)
// plus the draft→request→card and workflow/task/todo approval features.
// Mode ≠ behavior.
export const UserSettablePermissionModeSchema = z.enum([
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
  'dontAsk',
  'auto',
])

// Kebab-case handle (the `@mention` slug).
const SlugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be kebab-case (lowercase, digits, hyphens)')

const ToolPatternsSchema = z.array(z.string().min(1).max(200)).max(200)
const SkillIdsSchema = z.array(z.string().min(1).max(120)).max(50)

export const CreateAgentRequestSchema = z.object({
  slug: SlugSchema,
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(2000),
  prompt: z.string().min(1).max(50_000),
  scope: AgentScopeSchema,
  // Required when scope is 'workspace' (enforced in the handler).
  workspaceId: z.string().min(1).optional(),
  icon: z.string().min(1).max(80).optional(),
  model: z.string().min(1).max(120).optional(),
  effort: AgentEffortSchema.optional(),
  permissionMode: UserSettablePermissionModeSchema.optional(),
  background: z.boolean().optional(),
  allowedTools: ToolPatternsSchema.optional(),
  disallowedTools: ToolPatternsSchema.optional(),
  skillIds: SkillIdsSchema.optional(),
})

// PATCH — every field optional; nullable fields accept `null` to clear
// (reset to inherit). `skillIds` REPLACES the preload set when present.
export const UpdateAgentRequestSchema = z.object({
  slug: SlugSchema.optional(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().min(1).max(2000).optional(),
  prompt: z.string().min(1).max(50_000).optional(),
  icon: z.string().min(1).max(80).nullable().optional(),
  model: z.string().min(1).max(120).nullable().optional(),
  effort: AgentEffortSchema.nullable().optional(),
  permissionMode: UserSettablePermissionModeSchema.nullable().optional(),
  background: z.boolean().optional(),
  allowedTools: ToolPatternsSchema.nullable().optional(),
  disallowedTools: ToolPatternsSchema.nullable().optional(),
  enabled: z.boolean().optional(),
  skillIds: SkillIdsSchema.optional(),
})

export const SetAgentEnabledRequestSchema = z.object({
  enabled: z.boolean(),
})

// `POST /agents/curated/install` — install a Vynel-curated agent from the
// compiled-in catalog (`CURATED_AGENT_CATALOG`). Mirrors the skills-install
// shape (`{ skillId, scope }`): the client passes the catalog entry's
// `recommendedScope` as `scope`. When scope is 'workspace', workspaceId is
// required (enforced in the handler, like create — not a ZodEffects).
export const InstallCuratedAgentRequestSchema = z.object({
  slug: SlugSchema,
  scope: AgentScopeSchema,
  workspaceId: z.string().min(1).optional(),
})

export const AgentIdParamSchema = z.object({
  agentId: z.string().min(1),
})

export const AgentSlugParamSchema = z.object({
  slug: z.string().min(1),
})

// `GET /agents` — workspaceId is OPTIONAL: provide it for the workspace
// surface (user-scope ∪ that workspace's agents); omit it for the GLOBAL
// surface (user-scope agents only — there is no workspace to union in).
export const ListAgentsQuerySchema = z.object({
  workspaceId: z.string().min(1).optional(),
})

// `GET /agents/:slug` — workspaceId is OPTIONAL (omit = look up the
// user-scope agent; provide = look up that workspace's agent).
export const AgentSlugQuerySchema = z.object({
  workspaceId: z.string().min(1).optional(),
})

// ── Response schemas ────────────────────────────────────────────────
// The serialized shapes each route returns. `serializers.ts` derives its
// return TYPES from these via `z.infer` (one source of truth per shape),
// and the routes wire them into `describeRoute` responses via `resolver`
// so the OpenAPI spec — and therefore the generated SDK return types —
// are real, not `never`. Mirrors `schema/agents/agents.ts` (`AgentRow`)
// + the curated-catalog contract (`CuratedAgentDefinition`).

export const AgentSourceSchema = z.enum(['vynel', 'user', 'community'])
export const AgentTrustTierSchema = z.enum(['verified', 'anthropic-official', 'community'])

// The base agent shape — `serializeAgent`'s output (no preloaded skills;
// used by the list route to keep listing a single query).
export const AgentSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string().nullable(),
  prompt: z.string(),
  model: z.string().nullable(),
  effort: AgentEffortSchema.nullable(),
  permissionMode: UserSettablePermissionModeSchema.nullable(),
  background: z.boolean(),
  allowedTools: z.array(z.string()).nullable(),
  disallowedTools: z.array(z.string()).nullable(),
  scope: AgentScopeSchema,
  workspaceId: z.string().nullable(),
  source: AgentSourceSchema,
  trustTier: AgentTrustTierSchema,
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

// `serializeAgentWithSkills`'s output — the base shape + preloaded
// skill ids (create/install/get/update/enable all return this).
export const AgentWithSkillsSchema = AgentSchema.extend({
  skillIds: z.array(z.string()),
})

export const ListAgentsResponseSchema = z.array(AgentSchema)

// ── The hand-authored agent FILES (`.claude/agents/*.md` Vynel did not write)
// — addressed by file stem + { scope, workspaceId? }; the file is the record.
export const AgentFileSlugParamSchema = z.object({
  slug: z.string().min(1).max(120),
})

export const AgentFileScopeQuerySchema = z.object({
  scope: AgentScopeSchema,
  workspaceId: z.string().min(1).optional(),
})

export const ListAgentFilesQuerySchema = z.object({
  workspaceId: z.string().min(1).optional(),
})

export const WriteAgentFileBodySchema = z.object({
  scope: AgentScopeSchema,
  workspaceId: z.string().min(1).optional(),
  /** The whole file: a frontmatter block (name = the file stem, description) + the prompt. */
  content: z.string().min(1).max(100_000),
})

export const AgentFileSchema = z.object({
  slug: z.string(),
  fileName: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  tools: z.array(z.string()).nullable(),
  model: z.string().nullable(),
  content: z.string(),
  body: z.string(),
  scope: AgentScopeSchema,
})

export const ListAgentFilesResponseSchema = z.object({
  agentFiles: z.array(AgentFileSchema),
})

// `serializeCuratedAgent`'s output — a `CURATED_AGENT_CATALOG` entry as
// the Agents panel's browse shape. Optional catalog fields (`model`,
// `effort`, `permissionMode`) serialize to `null` when omitted.
export const CuratedAgentSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  iconName: z.string(),
  prompt: z.string(),
  model: z.string().nullable(),
  effort: AgentEffortSchema.nullable(),
  permissionMode: UserSettablePermissionModeSchema.nullable(),
  background: z.boolean(),
  allowedTools: z.array(z.string()).nullable(),
  disallowedTools: z.array(z.string()).nullable(),
  skillIds: z.array(z.string()),
  recommendedScope: AgentScopeSchema,
})

export const ListCuratedAgentsResponseSchema = z.array(CuratedAgentSchema)
