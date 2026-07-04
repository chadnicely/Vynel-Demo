// Pure async `fs.access` wrapper — returns `true` if the path
// exists and is readable, `false` otherwise. Used by
// `synchronizeSkillsWithProvider` to verify each installed-skill
// row still points at a real SKILL.md.

import { access } from 'node:fs/promises'

export async function checkInstallLocationExists(installLocation: string): Promise<boolean> {
  try {
    await access(installLocation)
    return true
  } catch {
    return false
  }
}
