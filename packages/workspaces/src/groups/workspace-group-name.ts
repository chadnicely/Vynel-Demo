// Shared name validation for workspace groups — one home so create and
// rename can never drift apart. Trimmed, non-empty, human-scale.

import { ValidationError } from '@vynel/errors'

export const MAX_WORKSPACE_GROUP_NAME_LENGTH = 60

export function normalizeWorkspaceGroupName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) {
    throw new ValidationError('Folder name cannot be empty. Give it a short label.')
  }
  if (trimmed.length > MAX_WORKSPACE_GROUP_NAME_LENGTH) {
    throw new ValidationError(
      `Folder name is too long (max ${MAX_WORKSPACE_GROUP_NAME_LENGTH} characters). Shorten it.`,
    )
  }
  return trimmed
}
