// The shared install choreography's disk-safety contract: a
// hand-authored `.claude/agents/<slug>.md` aborts the install untouched
// (twin of the removal-path protection in `agent-mirror-on-disk.test.ts`),
// and the mirror is written only for an ENABLED install (file present ⇔
// installed AND enabled).

import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { ConflictError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { findAgentBySlug } from '@vynel/db/repositories/agents'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { AGENT_CREATED } from '../agents-events.js'
import type { CreateAgentInput } from './create-agent.js'
import { installMarketplaceAgent } from './install-marketplace-agent.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vynel-agent-install-'))
  tempDirs.push(dir)
  return dir
}

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

function makeInstallInput(
  overrides: Partial<CreateAgentInput> & Pick<CreateAgentInput, 'userId' | 'workspaceId'>,
): CreateAgentInput {
  return {
    slug: 'focus-writer',
    name: 'Focus Writer',
    description: 'Writes.',
    prompt: 'You write.',
    source: 'community',
    trustTier: 'community',
    ...overrides,
  }
}

describe('installMarketplaceAgent', () => {
  it('aborts with ConflictError when a hand-authored agent file holds the path — file untouched, no row', async () => {
    await withTestDatabase(async (db) => {
      const workspaceDir = await makeTempDir()
      const { user, workspace } = seedWorkspace(db, workspaceDir)
      const mirrorPath = path.join(workspaceDir, '.claude', 'agents', 'focus-writer.md')
      await mkdir(path.dirname(mirrorPath), { recursive: true })
      const handAuthored = '---\nname: focus-writer\n---\nMy own agent.'
      await writeFile(mirrorPath, handAuthored, 'utf8')

      await expect(
        installMarketplaceAgent(
          db,
          makeInstallInput({ userId: user.id, workspaceId: workspace.id }),
        ),
      ).rejects.toBeInstanceOf(ConflictError)

      expect(await readFile(mirrorPath, 'utf8')).toBe(handAuthored)
      expect(
        findAgentBySlug(db, {
          userId: user.id,
          workspaceId: workspace.id,
          slug: 'focus-writer',
        }),
      ).toBeNull()
      expect(listOutboxEventsByType(db, AGENT_CREATED)).toHaveLength(0)
    })
  })

  it('skips the mirror write for a disabled install — no live filesystem agent for a disabled row', async () => {
    await withTestDatabase(async (db) => {
      const workspaceDir = await makeTempDir()
      const { user, workspace } = seedWorkspace(db, workspaceDir)
      const mirrorPath = path.join(workspaceDir, '.claude', 'agents', 'focus-writer.md')

      const agent = await installMarketplaceAgent(
        db,
        makeInstallInput({ userId: user.id, workspaceId: workspace.id, enabled: false }),
      )

      expect(agent.enabled).toBe(false)
      expect(await fileExists(mirrorPath)).toBe(false)
    })
  })
})
