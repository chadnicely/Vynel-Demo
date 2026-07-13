// The cloud-agent install security core over the real product DB:
// integrity-verify-first, manifest extraction + zod validation, the
// slug === itemId anchor, the community source/trust stamp, the disk
// transparency mirror — plus the failure paths (sha mismatch, bad
// archive, missing/invalid agent.json, slug mismatch, unsafe
// permissionMode, duplicate). Workspace paths are per-test tmpdirs and
// user-scope installs isolate the host home (installs now write
// `.claude/agents/<slug>.md` for real).

import path from 'node:path'
import os from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import JSZip from 'jszip'
import { afterEach, describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { findAgentBySlug } from '@vynel/db/repositories/agents'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { ValidationError } from '@vynel/errors'
import type { AgentItemManifest } from '@vynel/contracts/marketplace/agent-item-manifest'
import { installCloudAgent } from './install-cloud-agent.js'
import { withHomeDir } from '../internal/resolve-host-home-dir.js'
import { AGENT_CREATED } from '../agents-events.js'

const tempDirs: string[] = []

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function withIsolatedHome<T>(fn: (homeDir: string) => Promise<T>): Promise<T> {
  const homeDir = await makeTempDir('vynel-agents-home-')
  return withHomeDir(homeDir, () => fn(homeDir))
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function mirrorPathIn(rootDir: string, slug: string): string {
  return path.join(rootDir, '.claude', 'agents', `${slug}.md`)
}

function makeManifest(overrides: Partial<AgentItemManifest> = {}): AgentItemManifest {
  return {
    slug: 'focus-writer',
    name: 'Focus Writer',
    description: 'Turns rough notes into polished prose.',
    prompt: 'You are a focused writing assistant.',
    ...overrides,
  }
}

async function makeArtifact(files: Record<string, string>): Promise<{ bytes: Buffer; sha: string }> {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(files)) zip.file(name, content)
  const bytes = await zip.generateAsync({ type: 'nodebuffer' })
  return { bytes, sha: createHash('sha256').update(bytes).digest('hex') }
}

async function manifestArtifact(manifest: unknown): Promise<{ bytes: Buffer; sha: string }> {
  return makeArtifact({ 'agent.json': JSON.stringify(manifest) })
}

async function seed(db: Parameters<Parameters<typeof withTestDatabase>[0]>[0]) {
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
  // A REAL per-test tmpdir — workspace-scope installs write the mirror
  // under `<workspacePath>/.claude/agents/`.
  const workspace = insertWorkspace(db, {
    id: randomUUID(),
    userId: user.id,
    name: 'Acme',
    kind: 'small-business',
    path: await makeTempDir('vynel-agents-ws-'),
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return { user, workspace }
}

describe('installCloudAgent', () => {
  it('verifies, parses agent.json, and creates a community-trust agent row', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = await seed(db)
      const { bytes, sha } = await manifestArtifact(
        makeManifest({ icon: 'pen-line', model: 'sonnet', effort: 'medium', allowedTools: ['Read'] }),
      )
      const row = await installCloudAgent(db, {
        userId: user.id,
        workspaceId: workspace.id,
        itemId: 'focus-writer',
        scope: 'workspace',
        artifactBytes: bytes,
        expectedSha256: sha,
      })
      expect(row.slug).toBe('focus-writer')
      expect(row.source).toBe('community')
      expect(row.trustTier).toBe('community')
      expect(row.enabled).toBe(true)
      expect(row.scope).toBe('workspace')
      expect(row.workspaceId).toBe(workspace.id)
      expect(row.icon).toBe('pen-line')
      expect(row.model).toBe('sonnet')
      expect(row.effort).toBe('medium')
      expect(row.allowedTools).toEqual(['Read'])
      // Persisted, not just returned.
      expect(
        findAgentBySlug(db, { userId: user.id, workspaceId: workspace.id, slug: 'focus-writer' })?.id,
      ).toBe(row.id)

      // The transparency mirror landed in the WORKSPACE's .claude/agents,
      // and its content matches the row.
      const mirror = await readFile(mirrorPathIn(workspace.path, 'focus-writer'), 'utf8')
      expect(mirror).toContain('Managed by Vynel')
      expect(mirror).toContain('name: "focus-writer"')
      expect(mirror).toContain(`description: ${JSON.stringify(row.description)}`)
      expect(mirror).toContain('tools: "Read"')
      expect(mirror).toContain('model: "sonnet"')
      expect(mirror).toContain(row.prompt)

      // Exactly ONE agent.created — emitted by the delegated createAgent,
      // never doubled by the install wrapper; `source` carries provenance.
      const events = listOutboxEventsByType(db, AGENT_CREATED)
      expect(events).toHaveLength(1)
      const payload = events[0]!.payload as Record<string, unknown>
      expect(payload.agentId).toBe(row.id)
      expect(payload.source).toBe('community')
    })
  })

  it('installs at user scope (workspaceId null) when scope=user, mirroring into the home', async () => {
    await withTestDatabase(async (db) => {
      await withIsolatedHome(async (homeDir) => {
        const { user, workspace } = await seed(db)
        const { bytes, sha } = await manifestArtifact(makeManifest())
        const row = await installCloudAgent(db, {
          userId: user.id,
          workspaceId: workspace.id,
          itemId: 'focus-writer',
          scope: 'user',
          artifactBytes: bytes,
          expectedSha256: sha,
        })
        expect(row.scope).toBe('user')
        expect(row.workspaceId).toBeNull()
        // User-scope mirrors live under `~/.claude/agents/` — skills'
        // user home convention, never the workspace dir.
        expect(await fileExists(mirrorPathIn(homeDir, 'focus-writer'))).toBe(true)
        expect(await fileExists(mirrorPathIn(workspace.path, 'focus-writer'))).toBe(false)
      })
    })
  })

  it('installs at user scope with NO workspace at all (the global marketplace path)', async () => {
    await withTestDatabase(async (db) => {
      await withIsolatedHome(async (homeDir) => {
        const { user } = await seed(db)
        const { bytes, sha } = await manifestArtifact(makeManifest())
        const row = await installCloudAgent(db, {
          userId: user.id,
          workspaceId: null,
          itemId: 'focus-writer',
          scope: 'user',
          artifactBytes: bytes,
          expectedSha256: sha,
        })
        expect(row.scope).toBe('user')
        expect(row.workspaceId).toBeNull()
        expect(await fileExists(mirrorPathIn(homeDir, 'focus-writer'))).toBe(true)
      })
    })
  })

  it('rejects a workspace-scope install missing its workspace id', async () => {
    await withTestDatabase(async (db) => {
      const { user } = await seed(db)
      const { bytes, sha } = await manifestArtifact(makeManifest())
      await expect(
        installCloudAgent(db, {
          userId: user.id,
          workspaceId: null,
          itemId: 'focus-writer',
          scope: 'workspace',
          artifactBytes: bytes,
          expectedSha256: sha,
        }),
      ).rejects.toBeInstanceOf(ValidationError)
    })
  })

  it('rejects a sha256 mismatch BEFORE parsing anything', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = await seed(db)
      const { bytes } = await manifestArtifact(makeManifest())
      await expect(
        installCloudAgent(db, {
          userId: user.id,
          workspaceId: workspace.id,
          itemId: 'focus-writer',
          scope: 'workspace',
          artifactBytes: bytes,
          expectedSha256: 'b'.repeat(64),
        }),
      ).rejects.toMatchObject({ code: 'validation_failed' })
    })
  })

  it('rejects a non-archive, a missing agent.json, and invalid JSON', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = await seed(db)
      const base = { userId: user.id, workspaceId: workspace.id, itemId: 'x', scope: 'workspace' as const }

      const garbage = Buffer.from('not a zip')
      await expect(
        installCloudAgent(db, {
          ...base,
          artifactBytes: garbage,
          expectedSha256: createHash('sha256').update(garbage).digest('hex'),
        }),
      ).rejects.toMatchObject({ code: 'validation_failed' })

      const noManifest = await makeArtifact({ 'README.md': 'no agent here' })
      await expect(
        installCloudAgent(db, { ...base, artifactBytes: noManifest.bytes, expectedSha256: noManifest.sha }),
      ).rejects.toMatchObject({ code: 'validation_failed' })

      const badJson = await makeArtifact({ 'agent.json': '{not json' })
      await expect(
        installCloudAgent(db, { ...base, artifactBytes: badJson.bytes, expectedSha256: badJson.sha }),
      ).rejects.toMatchObject({ code: 'validation_failed' })
    })
  })

  it('rejects a manifest that fails the schema (empty prompt, unsafe permissionMode)', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = await seed(db)
      const base = { userId: user.id, workspaceId: workspace.id, itemId: 'focus-writer', scope: 'workspace' as const }

      const emptyPrompt = await manifestArtifact({ ...makeManifest(), prompt: '' })
      await expect(
        installCloudAgent(db, { ...base, artifactBytes: emptyPrompt.bytes, expectedSha256: emptyPrompt.sha }),
      ).rejects.toMatchObject({ code: 'validation_failed' })

      // A community artifact never models the approval-card-skip pattern.
      const bypass = await manifestArtifact({ ...makeManifest(), permissionMode: 'bypassPermissions' })
      await expect(
        installCloudAgent(db, { ...base, artifactBytes: bypass.bytes, expectedSha256: bypass.sha }),
      ).rejects.toMatchObject({ code: 'validation_failed' })
    })
  })

  it('rejects a manifest that out-bounds the user-create caps (prompt length, tool-list size)', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = await seed(db)
      const base = { userId: user.id, workspaceId: workspace.id, itemId: 'focus-writer', scope: 'workspace' as const }

      // prompt cap mirrors the user-create route's 50_000 — a community
      // artifact must not out-bound what the user can create by hand.
      const hugePrompt = await manifestArtifact({ ...makeManifest(), prompt: 'a'.repeat(50_001) })
      await expect(
        installCloudAgent(db, { ...base, artifactBytes: hugePrompt.bytes, expectedSha256: hugePrompt.sha }),
      ).rejects.toMatchObject({ code: 'validation_failed' })

      const tooManyTools = await manifestArtifact({
        ...makeManifest(),
        allowedTools: Array.from({ length: 65 }, (_, i) => `Tool${i}`),
      })
      await expect(
        installCloudAgent(db, { ...base, artifactBytes: tooManyTools.bytes, expectedSha256: tooManyTools.sha }),
      ).rejects.toMatchObject({ code: 'validation_failed' })
    })
  })

  it('installs when the hub records the expected sha256 in uppercase hex', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = await seed(db)
      const { bytes, sha } = await manifestArtifact(makeManifest())
      const row = await installCloudAgent(db, {
        userId: user.id,
        workspaceId: workspace.id,
        itemId: 'focus-writer',
        scope: 'workspace',
        artifactBytes: bytes,
        expectedSha256: sha.toUpperCase(),
      })
      expect(row.slug).toBe('focus-writer')
    })
  })

  it('rejects a manifest whose slug does not match the catalog itemId', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = await seed(db)
      const { bytes, sha } = await manifestArtifact(makeManifest({ slug: 'other-slug' }))
      await expect(
        installCloudAgent(db, {
          userId: user.id,
          workspaceId: workspace.id,
          itemId: 'focus-writer',
          scope: 'workspace',
          artifactBytes: bytes,
          expectedSha256: sha,
        }),
      ).rejects.toMatchObject({ code: 'validation_failed' })
    })
  })

  it('rejects a duplicate install at the same scope', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = await seed(db)
      const { bytes, sha } = await manifestArtifact(makeManifest())
      const input = {
        userId: user.id,
        workspaceId: workspace.id,
        itemId: 'focus-writer',
        scope: 'workspace' as const,
        artifactBytes: bytes,
        expectedSha256: sha,
      }
      await installCloudAgent(db, input)
      const mirrorPath = mirrorPathIn(workspace.path, 'focus-writer')
      const originalMirror = await readFile(mirrorPath, 'utf8')

      await expect(installCloudAgent(db, input)).rejects.toMatchObject({ code: 'conflict' })
      // The duplicate pre-check fires BEFORE any disk touch — the live
      // agent's mirror is untouched by the failed install.
      expect(await readFile(mirrorPath, 'utf8')).toBe(originalMirror)
    })
  })

  it('leaves no mirror behind when the install is rejected before the row', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = await seed(db)
      const { bytes } = await manifestArtifact(makeManifest())
      await expect(
        installCloudAgent(db, {
          userId: user.id,
          workspaceId: workspace.id,
          itemId: 'focus-writer',
          scope: 'workspace',
          artifactBytes: bytes,
          expectedSha256: 'b'.repeat(64),
        }),
      ).rejects.toMatchObject({ code: 'validation_failed' })
      expect(await fileExists(mirrorPathIn(workspace.path, 'focus-writer'))).toBe(false)
    })
  })
})
