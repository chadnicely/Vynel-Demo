// Zod request/query schemas for `workspace-apps` routes. Caps mirror the core
// op's APP_NAME_MAX_LENGTH / APP_COMMAND_MAX_LENGTH; the folder/port rules
// re-validate in the op (defense at both boundaries).

import { z } from 'zod'

export const AppParamSchema = z.object({
  appId: z.string().min(1),
})

export const AppLogsQuerySchema = z.object({
  tail: z.coerce.number().int().min(1).max(2000).optional(),
})

const appFields = {
  name: z.string().min(1).max(60),
  command: z.string().min(1).max(500),
  cwdRelative: z.string().max(300).optional(),
  envFileRelative: z.string().min(1).max(300).optional(),
  port: z.number().int().min(1).max(65535).optional(),
}

export const RegisterAppRequestSchema = z.object(appFields)

export const UpdateAppRequestSchema = z.object({
  name: appFields.name.optional(),
  command: appFields.command.optional(),
  cwdRelative: z.string().max(300).optional(),
  envFileRelative: z.string().min(1).max(300).optional(),
  port: z.number().int().min(1).max(65535).nullable().optional(),
})

// ── The env editor (user-only; the routes carry no x-mcp) ──────────

// One env var: dotenv key shape, single-line value. The write op re-validates
// the same rules (defense at both boundaries).
const AppEnvEntrySchema = z.object({
  key: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Keys are letters, digits and underscores.'),
  // Generous cap: one-line PEMs and service-account JSON blobs are real env
  // values, and a file that already holds one must stay saveable.
  value: z
    .string()
    .max(20_000)
    .refine((value) => !/[\r\n]/.test(value), 'Values must be a single line.'),
})

// The FULL desired state — keys absent from `entries` are removed.
export const UpdateAppEnvRequestSchema = z.object({
  entries: z.array(AppEnvEntrySchema).max(200),
})

// ── Response schemas ────────────────────────────────────────────────
// Structurally mirror `WorkspaceAppResponse` from
// `@vynel/contracts/apps/app-http` (the tasks/asks precedent).

const AppRuntimeSchema = z.object({
  status: z.enum(['running', 'exited', 'crashed']),
  pid: z.number().nullable(),
  startedAt: z.string(),
  exitCode: z.number().nullable(),
})

export const WorkspaceAppResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  command: z.string(),
  cwdRelative: z.string(),
  envFileRelative: z.string(),
  port: z.number().nullable(),
  runtime: AppRuntimeSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

// Mirrors `AppEnvResponse` from `@vynel/contracts/apps/app-http`.
export const AppEnvResponseSchema = z.object({
  envFileRelative: z.string(),
  exists: z.boolean(),
  entries: z.array(z.object({ key: z.string(), value: z.string() })),
})

export const ListWorkspaceAppsResponseSchema = z.array(WorkspaceAppResponseSchema)

export const AppLogsResponseSchema = z.object({
  lines: z.array(z.string()),
})
