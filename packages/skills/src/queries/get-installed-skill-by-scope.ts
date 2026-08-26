// The skill-file doors address a skill by `skillId` + scope (the way Claude
// and the shelf name it), never by row id — this is the one lookup from
// that address to the row, tenant-filtered; a miss throws (the
// `findX` / `getXOrThrow` rule) so the routes stay parse → call → shape.

import type { Database } from '@vynel/db'
import { NotFoundError } from '@vynel/errors'
import * as installedSkillsRepository from '../repositories/index.js'
import type { InstalledSkillRow } from '../repositories/index.js'

export type GetInstalledSkillByScopeInput = {
  userId: string
  /** null = user scope. */
  workspaceId: string | null
  skillId: string
}

export function getInstalledSkillByScopeOrThrow(
  db: Database,
  input: GetInstalledSkillByScopeInput,
): InstalledSkillRow {
  const row = installedSkillsRepository.findInstalledSkillByScope(db, input)
  if (row === null) throw new NotFoundError('installed-skill', input.skillId)
  return row
}
