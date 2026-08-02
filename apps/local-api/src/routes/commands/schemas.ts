// Zod response schemas for the `commands` routes (read-only — the view
// lists the slash commands each scope carries; Task 3's "/" menu reuses
// the same rows). API-internal, under the route folder.

import { z } from 'zod'

export const CommandRowSchema = z.object({
  /** The slash name without the slash (`git/commit.md` → `git:commit`). */
  commandName: z.string(),
  relativePath: z.string(),
  description: z.string().nullable(),
  argumentHint: z.string().nullable(),
  bodyPreview: z.string().nullable(),
  scope: z.enum(['user', 'workspace']),
})

export const ListCommandsResponseSchema = z.object({
  commands: z.array(CommandRowSchema),
})
