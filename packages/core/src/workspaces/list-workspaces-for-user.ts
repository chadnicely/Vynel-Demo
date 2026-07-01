// List a user's workspaces. Thin pass-through to the repo; lives in
// core because routes never call repos directly. The optional `limit`
// threads through to the repo's defensive cap (default 100, max 500 per
// coding-standard.md "Structure / patterns"). Per blueprint §6.2.

import * as workspacesRepository from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import type { Workspace } from '@vynel/db/repositories/workspaces'

export type ListWorkspacesForUserInput = {
  userId: string
  includeArchived?: boolean
  limit?: number
}

export async function listWorkspacesForUser(
  db: Database,
  input: ListWorkspacesForUserInput,
): Promise<Workspace[]> {
  const options: { includeArchived?: boolean; limit?: number } = {}
  if (input.includeArchived !== undefined) options.includeArchived = input.includeArchived
  if (input.limit !== undefined) options.limit = input.limit
  return workspacesRepository.listWorkspacesForUser(db, input.userId, options)
}
