// Creates one of the user's OWN skills — a new `<root>/<skillId>/SKILL.md`
// written from parts (the editor's form and Claude's `create_skill` share
// this renderer) — then the row, disk-first like every install (D8): a
// failed write leaves no row; a failed commit leaves a folder the next
// list's sync adopts as `external`. Supporting files come after, through
// `writeSkillFile`. A folder already on disk is refused rather than
// overwritten — it is someone's work; the list's sync will show it.

import { randomUUID } from 'node:crypto'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { withTransaction, type Database } from '@vynel/db'
import { ConflictError, ValidationError } from '@vynel/errors'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import * as installedSkillsRepository from '../repositories/index.js'
import type { InstalledSkillRow, SkillScope } from '../repositories/index.js'
import { resolveSkillsRoot } from '../internal/resolve-skills-root.js'
import { requireWorkspaceInstallBinding } from '../internal/require-workspace-install-binding.js'
import { renderSkillMarkdown } from '../skill-files/skill-markdown-frontmatter.js'
import type { StructuralLogger } from '../skills-types.js'
import { SKILL_INSTALLED, type SkillInstalledPayload } from '../skills-events.js'

// Claude Code skill names are kebab-case; the id is also the folder name.
export const SAFE_SKILL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const MAX_SKILL_ID_LENGTH = 64
export const MAX_SKILL_DESCRIPTION_LENGTH = 1024
export const MAX_SKILL_BODY_LENGTH = 200_000

export type CreateOwnSkillInput = {
  userId: string
  workspaceId: string | null
  workspacePath: string | null
  scope: SkillScope
  skillId: string
  description: string
  body: string
}

export async function createOwnSkill(
  db: Database,
  input: CreateOwnSkillInput,
  deps: { logger?: StructuralLogger } = {},
): Promise<InstalledSkillRow> {
  const workspaceBinding =
    input.scope === 'workspace' ? requireWorkspaceInstallBinding(input) : null
  assertSkillParts(input)

  const existing = installedSkillsRepository.findInstalledSkillByScope(db, {
    userId: input.userId,
    workspaceId: workspaceBinding?.workspaceId ?? null,
    skillId: input.skillId,
  })
  if (existing) {
    throw new ConflictError(`A skill named '${input.skillId}' is already installed at ${input.scope} scope.`)
  }

  const skillsRoot = resolveSkillsRoot(input.scope, workspaceBinding?.workspacePath)
  const skillFolder = path.join(skillsRoot, input.skillId)
  if (await exists(skillFolder)) {
    throw new ConflictError(
      `A folder named '${input.skillId}' already exists in the ${input.scope} skills folder — ` +
        'open the skills list to pick it up, or choose another name.',
    )
  }

  const installLocation = path.join(skillFolder, 'SKILL.md')
  const markdown = renderSkillMarkdown({
    skillId: input.skillId,
    description: input.description.trim(),
    body: input.body,
  })
  // `wx`: the folder check above can lose a race with a concurrent create
  // (or a folder appearing); exclusive-create turns that into the same
  // ConflictError instead of overwriting the winner's SKILL.md.
  await mkdir(skillFolder, { recursive: true })
  try {
    await writeFile(installLocation, markdown, { encoding: 'utf8', flag: 'wx' })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new ConflictError(
        `A skill named '${input.skillId}' already exists in the ${input.scope} skills folder.`,
      )
    }
    throw err
  }

  const now = new Date()
  const installedSkill = insertRowOrConflict(db, input.skillId, () =>
    withTransaction(db, (tx) => {
    const inserted = installedSkillsRepository.insertInstalledSkill(tx, {
      id: randomUUID(),
      userId: input.userId,
      workspaceId: workspaceBinding?.workspaceId ?? null,
      skillId: input.skillId,
      scope: input.scope,
      installedFromSource: 'user',
      versionInstalled: 'unknown',
      installLocation,
      installHealth: 'healthy',
      installHealthMessage: null,
      installedAt: now,
      updatedAt: now,
    })
    const payload: SkillInstalledPayload = {
      installedSkillId: inserted.id,
      userId: inserted.userId,
      workspaceId: inserted.workspaceId,
      skillId: inserted.skillId,
      scope: inserted.scope,
      version: inserted.versionInstalled,
      source: inserted.installedFromSource,
      installedAt: inserted.installedAt.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: SKILL_INSTALLED,
      payload,
      createdAt: now,
      processedAt: null,
    })
    return inserted
    }),
  )

  deps.logger?.info(
    { skillId: input.skillId, scope: input.scope, installedSkillId: installedSkill.id },
    'skill created',
  )
  return installedSkill
}

function assertSkillParts(input: Pick<CreateOwnSkillInput, 'skillId' | 'description' | 'body'>): void {
  if (input.skillId.length > MAX_SKILL_ID_LENGTH || !SAFE_SKILL_ID.test(input.skillId)) {
    throw new ValidationError(
      `Skill name '${input.skillId}' must be kebab-case letters, digits and dashes (e.g. "weekly-report").`,
    )
  }
  const description = input.description.trim()
  if (description.length === 0 || /[\r\n]/.test(description)) {
    throw new ValidationError('A skill needs a one-line description — it is how Claude knows when to use it.')
  }
  if (description.length > MAX_SKILL_DESCRIPTION_LENGTH) {
    throw new ValidationError(`The description is capped at ${MAX_SKILL_DESCRIPTION_LENGTH} characters.`)
  }
  if (input.body.trim().length === 0) {
    throw new ValidationError('A skill needs instructions — write what Claude should do with it.')
  }
  if (input.body.length > MAX_SKILL_BODY_LENGTH) {
    throw new ValidationError(`SKILL.md is capped at ${MAX_SKILL_BODY_LENGTH} characters — move detail into a supporting file.`)
  }
}

// The unique index (user, workspace|null, skillId) is the in-tx backstop of
// the pre-check above; a race that reaches it is the same conflict, not a
// 500. The folder just written stays — the next list adopts it.
function insertRowOrConflict<T>(db: Database, skillId: string, insert: () => T): T {
  try {
    return insert()
  } catch (err) {
    if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) {
      throw new ConflictError(`A skill named '${skillId}' was installed a moment ago.`)
    }
    throw err
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}
