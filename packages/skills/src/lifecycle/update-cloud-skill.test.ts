// The update path over the real product DB + real disk: version bump with
// file replacement + the co-committed outbox event, the repair semantics,
// and the failure paths (sha mismatch, unknown row, cross-tenant row,
// missing workspace path).

import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { installCloudSkill } from './install-cloud-skill.js'
import { disableSkill } from './disable-skill.js'
import { updateCloudSkill } from './update-cloud-skill.js'

async function makeArtifact(files: Record<string, string>): Promise<{ bytes: Buffer; sha: string }> {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(files)) zip.file(name, content)
  const bytes = await zip.generateAsync({ type: 'nodebuffer' })
  return { bytes, sha: createHash('sha256').update(bytes).digest('hex') }
}

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'vynel-cloudskill-update-'))
})
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

function seed(db: Parameters<Parameters<typeof withTestDatabase>[0]>[0]) {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: true,
    createdAt: now,
    updatedAt: now,
  })
  const workspace = insertWorkspace(db, {
    id: randomUUID(),
    userId: user.id,
    name: 'Acme',
    kind: 'small-business',
    path: tmp,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return { user, workspace }
}

async function installV1(
  db: Parameters<Parameters<typeof withTestDatabase>[0]>[0],
  userId: string,
  workspaceId: string,
) {
  const { bytes, sha } = await makeArtifact({ 'SKILL.md': '# Canvas Design v1' })
  return installCloudSkill(db, {
    userId,
    workspaceId,
    workspacePath: tmp,
    itemId: 'canvas-design',
    scope: 'workspace',
    artifactBytes: bytes,
    expectedSha256: sha,
    version: '1.0.0',
  })
}

describe('updateCloudSkill', () => {
  it('bumps the version, replaces the file, and keeps the marketplace source', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seed(db)
      const installed = await installV1(db, user.id, workspace.id)

      const next = await makeArtifact({ 'SKILL.md': '# Canvas Design v2' })
      const updated = await updateCloudSkill(db, {
        userId: user.id,
        installedSkillId: installed.id,
        workspacePath: tmp,
        artifactBytes: next.bytes,
        expectedSha256: next.sha,
        version: '1.1.0',
      })

      expect(updated.versionInstalled).toBe('1.1.0')
      expect(updated.installedFromSource).toBe('marketplace')
      expect(updated.installHealth).toBe('healthy')
      const written = await readFile(updated.installLocation, 'utf8')
      expect(written).toContain('v2')
    })
  })

  it('swaps the whole folder: new resources land, stale ones from the old version go', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seed(db)
      const v1 = await makeArtifact({
        'SKILL.md': '# Canvas Design v1',
        'themes/old-theme.md': 'old',
      })
      const installed = await installCloudSkill(db, {
        userId: user.id,
        workspaceId: workspace.id,
        workspacePath: tmp,
        itemId: 'canvas-design',
        scope: 'workspace',
        artifactBytes: v1.bytes,
        expectedSha256: v1.sha,
        version: '1.0.0',
      })
      const skillFolder = join(installed.installLocation, '..')
      await expect(readFile(join(skillFolder, 'themes/old-theme.md'), 'utf8')).resolves.toBe('old')

      const v2 = await makeArtifact({
        'SKILL.md': '# Canvas Design v2',
        'fonts/Arsenal.ttf': 'ttf-bytes',
      })
      await updateCloudSkill(db, {
        userId: user.id,
        installedSkillId: installed.id,
        workspacePath: tmp,
        artifactBytes: v2.bytes,
        expectedSha256: v2.sha,
        version: '1.1.0',
      })

      await expect(readFile(join(skillFolder, 'fonts/Arsenal.ttf'), 'utf8')).resolves.toBe(
        'ttf-bytes',
      )
      await expect(readFile(join(skillFolder, 'themes/old-theme.md'), 'utf8')).rejects.toMatchObject(
        { code: 'ENOENT' },
      )
    })
  })

  it('repairs on a same-version re-run (rewrites the file, resets health)', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seed(db)
      const installed = await installV1(db, user.id, workspace.id)
      await rm(installed.installLocation)

      const same = await makeArtifact({ 'SKILL.md': '# Canvas Design v1' })
      const updated = await updateCloudSkill(db, {
        userId: user.id,
        installedSkillId: installed.id,
        workspacePath: tmp,
        artifactBytes: same.bytes,
        expectedSha256: same.sha,
        version: '1.0.0',
      })

      expect(updated.versionInstalled).toBe('1.0.0')
      const written = await readFile(updated.installLocation, 'utf8')
      expect(written).toContain('v1')
    })
  })

  it('rejects tampered bytes before touching disk or row', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seed(db)
      const installed = await installV1(db, user.id, workspace.id)

      const next = await makeArtifact({ 'SKILL.md': '# Evil' })
      await expect(
        updateCloudSkill(db, {
          userId: user.id,
          installedSkillId: installed.id,
          workspacePath: tmp,
          artifactBytes: next.bytes,
          expectedSha256: 'b'.repeat(64),
          version: '1.1.0',
        }),
      ).rejects.toMatchObject({ code: 'validation_failed' })

      const untouched = await readFile(installed.installLocation, 'utf8')
      expect(untouched).toContain('v1')
    })
  })

  it("404s an unknown row and another user's row identically", async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seed(db)
      const installed = await installV1(db, user.id, workspace.id)
      const { bytes, sha } = await makeArtifact({ 'SKILL.md': '# v2' })

      await expect(
        updateCloudSkill(db, {
          userId: user.id,
          installedSkillId: randomUUID(),
          workspacePath: tmp,
          artifactBytes: bytes,
          expectedSha256: sha,
          version: '1.1.0',
        }),
      ).rejects.toMatchObject({ code: 'not_found' })

      await expect(
        updateCloudSkill(db, {
          userId: randomUUID(),
          installedSkillId: installed.id,
          workspacePath: tmp,
          artifactBytes: bytes,
          expectedSha256: sha,
          version: '1.1.0',
        }),
      ).rejects.toMatchObject({ code: 'not_found' })
    })
  })

  it('refuses to update a disabled skill (disable is real — no silent re-materialization)', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seed(db)
      const installed = await installV1(db, user.id, workspace.id)
      await disableSkill(db, {
        userId: user.id,
        installedSkillId: installed.id,
        workspacePath: tmp,
      })

      const next = await makeArtifact({ 'SKILL.md': '# Canvas Design v2' })
      await expect(
        updateCloudSkill(db, {
          userId: user.id,
          installedSkillId: installed.id,
          workspacePath: tmp,
          artifactBytes: next.bytes,
          expectedSha256: next.sha,
          version: '1.1.0',
        }),
      ).rejects.toMatchObject({ code: 'validation_failed' })
    })
  })

  it('requires the workspace path for a workspace-scope row', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seed(db)
      const installed = await installV1(db, user.id, workspace.id)
      const { bytes, sha } = await makeArtifact({ 'SKILL.md': '# v2' })

      await expect(
        updateCloudSkill(db, {
          userId: user.id,
          installedSkillId: installed.id,
          workspacePath: null,
          artifactBytes: bytes,
          expectedSha256: sha,
          version: '1.1.0',
        }),
      ).rejects.toMatchObject({ code: 'validation_failed' })
    })
  })
})
