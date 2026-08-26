// The ONE way to go from an installed-skill row to its folder on disk. The
// row's `installLocation` (the absolute SKILL.md path) is the authority —
// never `<root>/<skillId>`: an external row's `skillId` is the frontmatter
// `name`, which need not equal the folder, and a folder recomputed from it
// once made uninstall delete nothing while dropping the row. Containment is
// re-asserted against the scope's skills root so a corrupted row can never
// point a recursive delete anywhere else.

import path from 'node:path'
import { ValidationError } from '@vynel/errors'
import type { InstalledSkillRow } from '../repositories/index.js'
import { resolveSkillsRoot } from './resolve-skills-root.js'

export function resolveInstalledSkillFolder(
  installedSkill: Pick<InstalledSkillRow, 'skillId' | 'scope' | 'installLocation'>,
  workspacePath?: string,
): string {
  const skillsRoot = resolveSkillsRoot(installedSkill.scope, workspacePath)
  const skillFolder = path.dirname(path.resolve(installedSkill.installLocation))
  const relative = path.relative(skillsRoot, skillFolder)
  const isDirectChild = relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative)
  if (!isDirectChild || relative.includes(path.sep)) {
    throw new ValidationError(
      `The skill '${installedSkill.skillId}' records an install location outside the ` +
        `${installedSkill.scope} skills folder — refresh the skills list to repair it.`,
    )
  }
  return skillFolder
}
