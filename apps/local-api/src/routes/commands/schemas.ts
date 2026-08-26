// Zod request + response schemas for the `commands` routes. API-internal,
// under the route folder. Length caps mirror the skills leaf's own-command
// writer (the core re-validates; this bounds the wire).

import { z } from 'zod'
import {
  MAX_COMMAND_ARGUMENT_HINT_LENGTH,
  MAX_COMMAND_BODY_LENGTH,
  MAX_COMMAND_DESCRIPTION_LENGTH,
  MAX_COMMAND_NAME_LENGTH,
} from '@vynel/skills'

export const CommandScopeSchema = z.enum(['user', 'workspace'])

export const CommandRowSchema = z.object({
  /** The slash name without the slash (`git/commit.md` → `git:commit`). */
  commandName: z.string(),
  relativePath: z.string(),
  description: z.string().nullable(),
  argumentHint: z.string().nullable(),
  bodyPreview: z.string().nullable(),
  /** The whole file — command files are small; powers the view dialog. */
  content: z.string(),
  /** The prompt after the frontmatter block — what the editor edits. */
  body: z.string(),
  scope: CommandScopeSchema,
})

export const ListCommandsResponseSchema = z.object({
  commands: z.array(CommandRowSchema),
})

// A workspace turn's resolved view sees the user folder + that workspace's;
// omit for the global surface (user folder only).
export const ResolvedCommandsQuerySchema = z.object({
  workspaceId: z.string().min(1).optional(),
})

// `git:commit` — stems joined by ":". Path safety is the skills leaf's
// `isSafeCommandName` (400 through the typed ValidationError); the wire only
// bounds the length.
export const CommandNameParamSchema = z.object({
  commandName: z.string().min(1).max(MAX_COMMAND_NAME_LENGTH),
})

export const WriteCommandBodySchema = z.object({
  scope: CommandScopeSchema,
  // Required when scope is 'workspace'; ignored for 'user' (a workspace
  // turn's ambient stamp may attach one) — `resolveScopeTarget` decides.
  workspaceId: z.string().min(1).optional(),
  description: z.string().max(MAX_COMMAND_DESCRIPTION_LENGTH).nullable().optional(),
  argumentHint: z.string().max(MAX_COMMAND_ARGUMENT_HINT_LENGTH).nullable().optional(),
  body: z.string().min(1).max(MAX_COMMAND_BODY_LENGTH),
})

export const CommandScopeQuerySchema = z.object({
  scope: CommandScopeSchema,
  workspaceId: z.string().min(1).optional(),
})
