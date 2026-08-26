// The hand-authored agent-file doors over a real isolated home + workspace
// dir: the scan lists unmarked `.claude/agents/*.md` files (never Vynel's
// mirrors), write validates a loadable file and refuses a mirror's path or
// a slug that already names a Vynel agent, delete refuses a mirror and 404s
// a missing file, and the parser reads the documented frontmatter keys.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import { withHomeDir } from '../internal/resolve-host-home-dir.js'
import { renderAgentMirrorMarkdown } from '../internal/render-agent-mirror-markdown.js'
import { parseAgentFile } from './agent-file-frontmatter.js'
import { listFileAgentsForScope, readFileAgentForScope } from './list-file-agents-for-scope.js'
import { writeFileAgentForScope } from './write-file-agent-for-scope.js'
import { deleteFileAgentForScope } from './delete-file-agent-for-scope.js'
import { createAgent } from '../lifecycle/create-agent.js'

function seedWorld(db: Database, workspacePath: string) {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'Dana',
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
    name: 'Bakery',
    kind: 'small-business',
    path: workspacePath,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return { user, workspace }
}

async function withWorld<T>(
  fn: (ctx: { db: Database; userId: string; workspaceId: string; homeDir: string; workspaceDir: string }) => Promise<T>,
): Promise<T> {
  const homeDir = mkdtempSync(join(tmpdir(), 'vynel-file-agents-home-'))
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-file-agents-ws-'))
  try {
    return await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db, workspaceDir)
      return withHomeDir(homeDir, () =>
        fn({ db, userId: user.id, workspaceId: workspace.id, homeDir, workspaceDir }),
      )
    })
  } finally {
    rmSync(homeDir, { recursive: true, force: true })
    rmSync(workspaceDir, { recursive: true, force: true })
  }
}

const HAND_MADE = '---\nname: reviewer\ndescription: Reviews code\ntools: Read, Grep\nmodel: sonnet\n---\n\nReview carefully.\n'

describe('listFileAgentsForScope', () => {
  it('lists hand-authored files with their frontmatter, skips Vynel mirrors and unsafe names', async () => {
    await withWorld(async ({ db, userId, homeDir }) => {
      const agentsDir = join(homeDir, '.claude', 'agents')
      mkdirSync(agentsDir, { recursive: true })
      writeFileSync(join(agentsDir, 'reviewer.md'), HAND_MADE, 'utf8')
      writeFileSync(join(agentsDir, '.draft.md'), HAND_MADE, 'utf8')
      await createAgent(db, {
        userId,
        workspaceId: null,
        slug: 'managed',
        name: 'Managed',
        description: 'd',
        prompt: 'p',
        source: 'user',
        trustTier: 'community',
      })
      expect(existsSync(join(agentsDir, 'managed.md'))).toBe(true)

      expect(listFileAgentsForScope('user')).toEqual([
        {
          slug: 'reviewer',
          fileName: 'reviewer.md',
          name: 'reviewer',
          description: 'Reviews code',
          tools: ['Read', 'Grep'],
          model: 'sonnet',
          content: HAND_MADE,
          body: 'Review carefully.\n',
        },
      ])
      expect(readFileAgentForScope('user', 'managed')).toBeNull()
      expect(readFileAgentForScope('user', 'reviewer')?.slug).toBe('reviewer')
    })
  })
})

describe('writeFileAgentForScope', () => {
  it('writes a loadable file at either scope and replaces on a second write', async () => {
    await withWorld(async ({ db, userId, workspaceId, homeDir, workspaceDir }) => {
      const { filePath } = await writeFileAgentForScope(db, {
        userId,
        scope: 'user',
        workspaceId: null,
        slug: 'reviewer',
        content: HAND_MADE,
      })
      expect(filePath).toBe(join(homeDir, '.claude', 'agents', 'reviewer.md'))
      await writeFileAgentForScope(db, {
        userId,
        scope: 'workspace',
        workspaceId,
        workspacePath: workspaceDir,
        slug: 'reviewer',
        content: HAND_MADE.replace('Review carefully.', 'Review twice.'),
      })
      expect(readFileSync(join(workspaceDir, '.claude', 'agents', 'reviewer.md'), 'utf8')).toContain(
        'Review twice.',
      )
    })
  })

  it('refuses a file that would not load, a mirror path, and a slug Vynel already owns', async () => {
    await withWorld(async ({ db, userId, homeDir }) => {
      for (const bad of ['no frontmatter', '---\nname: other\ndescription: d\n---\nx', '---\nname: reviewer\n---\nx', '---\nname: reviewer\ndescription: d\n---\n']) {
        await expect(
          writeFileAgentForScope(db, { userId, scope: 'user', workspaceId: null, slug: 'reviewer', content: bad }),
        ).rejects.toMatchObject({ code: 'validation_failed' })
      }

      const agentsDir = join(homeDir, '.claude', 'agents')
      mkdirSync(agentsDir, { recursive: true })
      writeFileSync(
        join(agentsDir, 'mirrored.md'),
        renderAgentMirrorMarkdown({ slug: 'mirrored', name: 'M', description: 'd', prompt: 'p' }),
        'utf8',
      )
      await expect(
        writeFileAgentForScope(db, {
          userId,
          scope: 'user',
          workspaceId: null,
          slug: 'mirrored',
          content: HAND_MADE.replace('name: reviewer', 'name: mirrored'),
        }),
      ).rejects.toMatchObject({ code: 'conflict' })

      await createAgent(db, {
        userId,
        workspaceId: null,
        slug: 'owned',
        name: 'Owned',
        description: 'd',
        prompt: 'p',
        source: 'user',
        trustTier: 'community',
        enabled: false,
      })
      await expect(
        writeFileAgentForScope(db, {
          userId,
          scope: 'user',
          workspaceId: null,
          slug: 'owned',
          content: HAND_MADE.replace('name: reviewer', 'name: owned'),
        }),
      ).rejects.toMatchObject({ code: 'conflict' })
    })
  })
})

describe('deleteFileAgentForScope', () => {
  it('removes a hand-authored file, refuses a mirror, 404s when missing', async () => {
    await withWorld(async ({ db, userId, homeDir }) => {
      const agentsDir = join(homeDir, '.claude', 'agents')
      mkdirSync(agentsDir, { recursive: true })
      writeFileSync(join(agentsDir, 'reviewer.md'), HAND_MADE, 'utf8')
      await deleteFileAgentForScope({ scope: 'user', slug: 'reviewer' })
      expect(existsSync(join(agentsDir, 'reviewer.md'))).toBe(false)
      await expect(deleteFileAgentForScope({ scope: 'user', slug: 'reviewer' })).rejects.toMatchObject({
        code: 'not_found',
      })

      await createAgent(db, {
        userId,
        workspaceId: null,
        slug: 'managed',
        name: 'Managed',
        description: 'd',
        prompt: 'p',
        source: 'user',
        trustTier: 'community',
      })
      await expect(deleteFileAgentForScope({ scope: 'user', slug: 'managed' })).rejects.toMatchObject({
        code: 'conflict',
      })
      expect(existsSync(join(agentsDir, 'managed.md'))).toBe(true)
    })
  })
})

describe('parseAgentFile', () => {
  it('reads the documented keys, tolerates BOM/CRLF and quoted values, flags mirrors', () => {
    expect(parseAgentFile('﻿---\r\nname: "a: b"\r\ndescription: \'d\'\r\ntools: Read,Grep\r\n---\r\n\r\nBody\r\n')).toEqual({
      name: 'a: b',
      description: 'd',
      tools: ['Read', 'Grep'],
      model: null,
      body: 'Body\n',
      isManagedMirror: false,
    })
    expect(parseAgentFile('just a prompt')).toMatchObject({ name: null, body: 'just a prompt' })
    expect(
      parseAgentFile(renderAgentMirrorMarkdown({ slug: 'x', name: 'X', description: 'd', prompt: 'p' }))
        .isManagedMirror,
    ).toBe(true)
  })
})
