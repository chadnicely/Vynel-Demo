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
  port: z.number().int().min(1).max(65535).optional(),
}

export const RegisterAppRequestSchema = z.object(appFields)

export const UpdateAppRequestSchema = z.object({
  name: appFields.name.optional(),
  command: appFields.command.optional(),
  cwdRelative: z.string().max(300).optional(),
  port: z.number().int().min(1).max(65535).nullable().optional(),
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
  port: z.number().nullable(),
  runtime: AppRuntimeSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const ListWorkspaceAppsResponseSchema = z.array(WorkspaceAppResponseSchema)

export const AppLogsResponseSchema = z.object({
  lines: z.array(z.string()),
})
