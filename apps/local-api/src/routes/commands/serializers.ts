// Serializer for the `commands` routes — the package's file listing + the
// surface's scope tag, field-for-field with `CommandRowSchema`.

import type { CommandFileForScope } from '@vynel/skills'
import type { z } from 'zod'
import type { CommandRowSchema } from './schemas.js'

export type CommandRow = z.infer<typeof CommandRowSchema>

export function serializeCommandFile(
  command: CommandFileForScope,
  scope: 'user' | 'workspace',
): CommandRow {
  return {
    commandName: command.commandName,
    relativePath: command.relativePath,
    description: command.description,
    argumentHint: command.argumentHint,
    bodyPreview: command.bodyPreview,
    content: command.content,
    body: command.body,
    scope,
  }
}
