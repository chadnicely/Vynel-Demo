// Disk behavior of the transparency mirror: write/remove roundtrip, the
// marker check that protects hand-authored files on BOTH removal and
// write, idempotent removal, and the enabled⇔present convergence of
// `syncAgentMirrorOnDisk`.

import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { ConflictError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { AgentRow } from '../agents-types.js'
import {
  removeAgentMirrorOnDisk,
  syncAgentMirrorOnDisk,
  writeAgentMirrorOnDisk,
} from './agent-mirror-on-disk.js'
import { AGENT_MIRROR_MANAGED_MARKER } from './render-agent-mirror-markdown.js'

const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vynel-agent-mirror-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

type TestDatabase = Parameters<Parameters<typeof withTestDatabase>[0]>[0]

function seedWorkspace(db: TestDatabase, workspacePath: string) {
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
    path: workspacePath,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return { user, workspace }
}

function makeAgentRow(overrides: Partial<AgentRow> & Pick<AgentRow, 'userId'>): AgentRow {
  const now = new Date()
  return {
    id: randomUUID(),
    workspaceId: null,
    slug: 'focus-writer',
    name: 'Focus Writer',
    description: 'Writes.',
    icon: null,
    prompt: 'You write.',
    model: null,
    effort: null,
    permissionMode: null,
    background: false,
    allowedTools: null,
    disallowedTools: null,
    scope: 'user',
    source: 'community',
    trustTier: 'community',
    enabled: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  }
}

describe('writeAgentMirrorOnDisk / removeAgentMirrorOnDisk', () => {
  it('writes (creating .claude/agents) and removes a managed mirror', async () => {
    await withTestDatabase(async (db) => {
      const workspaceDir = await makeTempDir()
      const { workspace } = seedWorkspace(db, workspaceDir)
      const mirrorPath = path.join(workspaceDir, '.claude', 'agents', 'focus-writer.md')

      await writeAgentMirrorOnDisk(mirrorPath, `# ${AGENT_MIRROR_MANAGED_MARKER}\nbody`)
      expect(await readFile(mirrorPath, 'utf8')).toContain(AGENT_MIRROR_MANAGED_MARKER)

      await removeAgentMirrorOnDisk(db, {
        scope: 'workspace',
        workspaceId: workspace.id,
        slug: 'focus-writer',
      })
      expect(await fileExists(mirrorPath)).toBe(false)
    })
  })

  it('leaves a hand-authored (marker-less) agent file in place', async () => {
    await withTestDatabase(async (db) => {
      const workspaceDir = await makeTempDir()
      const { workspace } = seedWorkspace(db, workspaceDir)
      const mirrorPath = path.join(workspaceDir, '.claude', 'agents', 'focus-writer.md')
      await mkdir(path.dirname(mirrorPath), { recursive: true })
      await writeFile(mirrorPath, '---\nname: focus-writer\n---\nMy own agent.', 'utf8')

      await removeAgentMirrorOnDisk(db, {
        scope: 'workspace',
        workspaceId: workspace.id,
        slug: 'focus-writer',
      })
      expect(await readFile(mirrorPath, 'utf8')).toContain('My own agent.')
    })
  })

  it('is a silent no-op when the file (or the workspace row) is missing', async () => {
    await withTestDatabase(async (db) => {
      const workspaceDir = await makeTempDir()
      const { workspace } = seedWorkspace(db, workspaceDir)
      await removeAgentMirrorOnDisk(db, {
        scope: 'workspace',
        workspaceId: workspace.id,
        slug: 'focus-writer',
      })
      await removeAgentMirrorOnDisk(db, {
        scope: 'workspace',
        workspaceId: randomUUID(),
        slug: 'focus-writer',
      })
    })
  })
})

describe('writeAgentMirrorOnDisk hand-authored guard', () => {
  it('refuses to overwrite a hand-authored (marker-less) agent file', async () => {
    const workspaceDir = await makeTempDir()
    const mirrorPath = path.join(workspaceDir, '.claude', 'agents', 'focus-writer.md')
    await mkdir(path.dirname(mirrorPath), { recursive: true })
    const handAuthored = '---\nname: focus-writer\n---\nMy own agent.'
    await writeFile(mirrorPath, handAuthored, 'utf8')

    await expect(
      writeAgentMirrorOnDisk(mirrorPath, `# ${AGENT_MIRROR_MANAGED_MARKER}\nbody`),
    ).rejects.toBeInstanceOf(ConflictError)
    expect(await readFile(mirrorPath, 'utf8')).toBe(handAuthored)
  })

  it('overwrites its own managed mirror freely', async () => {
    const workspaceDir = await makeTempDir()
    const mirrorPath = path.join(workspaceDir, '.claude', 'agents', 'focus-writer.md')
    await writeAgentMirrorOnDisk(mirrorPath, `# ${AGENT_MIRROR_MANAGED_MARKER}\nfirst`)
    await writeAgentMirrorOnDisk(mirrorPath, `# ${AGENT_MIRROR_MANAGED_MARKER}\nsecond`)
    expect(await readFile(mirrorPath, 'utf8')).toContain('second')
  })
})

describe('syncAgentMirrorOnDisk', () => {
  it('writes the mirror for an enabled agent and removes it once disabled', async () => {
    await withTestDatabase(async (db) => {
      const workspaceDir = await makeTempDir()
      const { user, workspace } = seedWorkspace(db, workspaceDir)
      const agent = makeAgentRow({
        userId: user.id,
        workspaceId: workspace.id,
        scope: 'workspace',
        model: 'sonnet',
      })
      const mirrorPath = path.join(workspaceDir, '.claude', 'agents', 'focus-writer.md')

      await syncAgentMirrorOnDisk(db, agent)
      const content = await readFile(mirrorPath, 'utf8')
      expect(content).toContain(AGENT_MIRROR_MANAGED_MARKER)
      expect(content).toContain('model: "sonnet"')
      expect(content).toContain('You write.')

      await syncAgentMirrorOnDisk(db, { ...agent, enabled: false })
      expect(await fileExists(mirrorPath)).toBe(false)
    })
  })

  it('skips the write and warns when a hand-authored file holds the path', async () => {
    await withTestDatabase(async (db) => {
      const workspaceDir = await makeTempDir()
      const { user, workspace } = seedWorkspace(db, workspaceDir)
      const agent = makeAgentRow({
        userId: user.id,
        workspaceId: workspace.id,
        scope: 'workspace',
      })
      const mirrorPath = path.join(workspaceDir, '.claude', 'agents', 'focus-writer.md')
      await mkdir(path.dirname(mirrorPath), { recursive: true })
      const handAuthored = '---\nname: focus-writer\n---\nMy own agent.'
      await writeFile(mirrorPath, handAuthored, 'utf8')

      const warns: string[] = []
      await syncAgentMirrorOnDisk(db, agent, {
        info: () => {},
        warn: (_payload, message) => warns.push(message ?? ''),
        error: () => {},
      })

      expect(await readFile(mirrorPath, 'utf8')).toBe(handAuthored)
      expect(warns).toHaveLength(1)
      expect(warns[0]).toContain('hand-authored')
    })
  })
})
