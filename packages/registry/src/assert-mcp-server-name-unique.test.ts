// The publish wall for the mcp serverName rule, over PGlite + the real
// publish path (every publish route funnels through publishCatalogArtifact,
// so refusing here IS the whole enforcement).

import { describe, expect, it } from 'vitest'
import { ValidationError } from '@vynel/errors'
import { withTestCloudDatabase } from '@vynel/cloud-db/testing'
import { publishCatalogArtifact } from './publish-catalog-artifact.js'
import { createInMemoryArtifactStore } from './artifact-store.js'
import { zipArtifact } from './testing.js'
import type { PublishItemInput } from './publish-input.js'

const ARTIFACT = await zipArtifact({ 'server-descriptor.json': '{}' })

function mcpPublishInput(
  itemId: string,
  serverName: string,
  version = '1.0.0',
): PublishItemInput {
  return {
    publisher: { id: 'vynel-team', name: 'Vynel Team', tier: 'verified', url: null },
    item: {
      itemId,
      kind: 'mcp',
      displayName: itemId,
      oneLineDescription: 'x',
      category: 'research',
      iconName: 'search',
      recommendedScope: 'user',
      minimumTier: 'basic',
      status: 'published',
    },
    version: {
      version,
      changelog: '',
      manifest: {
        serverName,
        transport: 'http',
        url: 'https://mcp.example.com/mcp',
      },
      minAppVersion: null,
    },
  }
}

describe('assertMcpServerNameUnique (via publishCatalogArtifact)', () => {
  it('refuses a second item declaring an existing serverName, naming the holder', async () => {
    await withTestCloudDatabase(async (db) => {
      const store = createInMemoryArtifactStore()
      await publishCatalogArtifact(db, store, {
        ...mcpPublishInput('notion-mcp', 'notion'),
        artifactBytes: ARTIFACT,
      })
      await expect(
        publishCatalogArtifact(db, store, {
          ...mcpPublishInput('notion-clone', 'notion'),
          artifactBytes: ARTIFACT,
        }),
      ).rejects.toThrow(ValidationError)
      await expect(
        publishCatalogArtifact(db, store, {
          ...mcpPublishInput('notion-clone', 'notion'),
          artifactBytes: ARTIFACT,
        }),
      ).rejects.toThrow(/already declared by catalog item 'notion-mcp'/)
    })
  })

  it('allows the SAME item to re-publish its name on a version bump', async () => {
    await withTestCloudDatabase(async (db) => {
      const store = createInMemoryArtifactStore()
      await publishCatalogArtifact(db, store, {
        ...mcpPublishInput('notion-mcp', 'notion'),
        artifactBytes: ARTIFACT,
      })
      const bumped = await publishCatalogArtifact(db, store, {
        ...mcpPublishInput('notion-mcp', 'notion', '1.0.1'),
        artifactBytes: ARTIFACT,
      })
      expect(bumped.version).toBe('1.0.1')
    })
  })

  it('distinct names publish freely; non-mcp kinds never hit the wall', async () => {
    await withTestCloudDatabase(async (db) => {
      const store = createInMemoryArtifactStore()
      await publishCatalogArtifact(db, store, {
        ...mcpPublishInput('notion-mcp', 'notion'),
        artifactBytes: ARTIFACT,
      })
      await publishCatalogArtifact(db, store, {
        ...mcpPublishInput('sentry-mcp', 'sentry'),
        artifactBytes: ARTIFACT,
      })
      const skill = mcpPublishInput('some-skill', 'notion')
      await publishCatalogArtifact(db, store, {
        ...skill,
        item: { ...skill.item, kind: 'skill' },
        artifactBytes: await zipArtifact({ 'SKILL.md': 'x' }),
      })
    })
  })
})
