// The cloud-install security core over the real product DB + real disk (temp
// workspace): integrity-verify-first, extraction, on-disk write, and the
// marketplace-source record — plus the failure paths (sha mismatch, bad
// archive, missing SKILL.md, duplicate).

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

async function makeArtifact(files: Record<string, string>): Promise<{ bytes: Buffer; sha: string }> {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(files)) zip.file(name, content)
  const bytes = await zip.generateAsync({ type: 'nodebuffer' })
  return { bytes, sha: createHash('sha256').update(bytes).digest('hex') }
}

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'vynel-cloudskill-'))
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

describe('installCloudSkill', () => {
  it('verifies, extracts, writes SKILL.md, and records the marketplace source', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seed(db)
      const { bytes, sha } = await makeArtifact({ 'SKILL.md': '# Email Drafter\nDrafts emails.' })
      const row = await installCloudSkill(db, {
        userId: user.id,
        workspaceId: workspace.id,
        workspacePath: tmp,
        itemId: 'email-drafter',
        scope: 'workspace',
        artifactBytes: bytes,
        expectedSha256: sha,
        version: '1.0.0',
      })
      expect(row.installedFromSource).toBe('marketplace')
      expect(row.skillId).toBe('email-drafter')
      expect(row.versionInstalled).toBe('1.0.0')
      const written = await readFile(row.installLocation, 'utf8')
      expect(written).toContain('Email Drafter')
    })
  })

  it('rejects a sha256 mismatch BEFORE writing anything', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seed(db)
      const { bytes } = await makeArtifact({ 'SKILL.md': '# X' })
      await expect(
        installCloudSkill(db, {
          userId: user.id,
          workspaceId: workspace.id,
          workspacePath: tmp,
          itemId: 'x',
          scope: 'workspace',
          artifactBytes: bytes,
          expectedSha256: 'b'.repeat(64),
          version: '1.0.0',
        }),
      ).rejects.toMatchObject({ code: 'validation_failed' })
    })
  })

  it('rejects a non-archive and an archive missing SKILL.md', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seed(db)
      const garbage = Buffer.from('not a zip')
      await expect(
        installCloudSkill(db, {
          userId: user.id, workspaceId: workspace.id, workspacePath: tmp, itemId: 'x',
          scope: 'workspace', artifactBytes: garbage,
          expectedSha256: createHash('sha256').update(garbage).digest('hex'), version: '1.0.0',
        }),
      ).rejects.toMatchObject({ code: 'validation_failed' })

      const { bytes, sha } = await makeArtifact({ 'README.md': 'no skill here' })
      await expect(
        installCloudSkill(db, {
          userId: user.id, workspaceId: workspace.id, workspacePath: tmp, itemId: 'x',
          scope: 'workspace', artifactBytes: bytes, expectedSha256: sha, version: '1.0.0',
        }),
      ).rejects.toMatchObject({ code: 'validation_failed' })
    })
  })

  it('refuses an unsafe (path-traversal) itemId before writing to disk', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seed(db)
      const { bytes, sha } = await makeArtifact({ 'SKILL.md': '# X' })
      await expect(
        installCloudSkill(db, {
          userId: user.id, workspaceId: workspace.id, workspacePath: tmp, itemId: '../evil',
          scope: 'workspace', artifactBytes: bytes, expectedSha256: sha, version: '1.0.0',
        }),
      ).rejects.toMatchObject({ code: 'validation_failed' })
    })
  })

  it('rejects a duplicate install at the same scope', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seed(db)
      const { bytes, sha } = await makeArtifact({ 'SKILL.md': '# X' })
      const input = {
        userId: user.id, workspaceId: workspace.id, workspacePath: tmp, itemId: 'dup',
        scope: 'workspace' as const, artifactBytes: bytes, expectedSha256: sha, version: '1.0.0',
      }
      await installCloudSkill(db, input)
      await expect(installCloudSkill(db, input)).rejects.toMatchObject({ code: 'conflict' })
    })
  })
})
