// The server-side import against a REAL local git fixture (no network) over
// PGlite + the in-memory store: a first run publishes faithful zips, a
// re-run skips everything without touching stored bytes, and a hand-published
// version survives the import untouched (byte-immutability).

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { withTestCloudDatabase } from '@vynel/cloud-db/testing'
import { ValidationError } from '@vynel/errors'
import { importAnthropicItems, type AnthropicImportManifest } from './import-anthropic.js'
import { publishCatalogArtifact } from './publish-catalog-artifact.js'
import { artifactKey, createInMemoryArtifactStore } from './artifact-store.js'
import { findItemVersion, findItemWithPublisher } from './repositories/catalog-repository.js'
import { zipArtifact } from './testing.js'

let fixtureRepo: string
let pinSha: string

function gitIn(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
}

beforeAll(() => {
  fixtureRepo = mkdtempSync(join(tmpdir(), 'vynel-import-fixture-'))
  execFileSync('git', ['init', '--initial-branch=main', fixtureRepo], { encoding: 'utf8' })
  gitIn(fixtureRepo, ['config', 'user.email', 'test@test'])
  gitIn(fixtureRepo, ['config', 'user.name', 'test'])

  mkdirSync(join(fixtureRepo, 'skills', 'canvas-design', 'assets'), { recursive: true })
  mkdirSync(join(fixtureRepo, 'skills', 'theme-factory'), { recursive: true })
  writeFileSync(join(fixtureRepo, 'skills', 'canvas-design', 'SKILL.md'), 'canvas skill', 'utf8')
  writeFileSync(join(fixtureRepo, 'skills', 'canvas-design', 'LICENSE.txt'), 'MIT', 'utf8')
  writeFileSync(join(fixtureRepo, 'skills', 'canvas-design', 'assets', 'grid.css'), '.g{}', 'utf8')
  writeFileSync(join(fixtureRepo, 'skills', 'theme-factory', 'SKILL.md'), 'theme skill', 'utf8')
  gitIn(fixtureRepo, ['add', '.'])
  gitIn(fixtureRepo, ['commit', '-m', 'pin'])
  pinSha = gitIn(fixtureRepo, ['rev-parse', 'HEAD'])
})

afterAll(() => {
  rmSync(fixtureRepo, { recursive: true, force: true })
})

function manifest(): AnthropicImportManifest {
  return {
    upstream: { repo: fixtureRepo, pinnedSha: pinSha },
    publisher: {
      id: 'anthropic',
      name: 'Anthropic',
      tier: 'anthropic-official',
      url: 'https://www.anthropic.com',
    },
    items: [
      {
        itemId: 'canvas-design',
        displayName: 'Canvas Design',
        oneLineDescription: 'Designs canvases.',
        category: 'design',
        iconName: 'palette',
        recommendedScope: 'user',
        version: '1.0.0',
      },
      {
        itemId: 'theme-factory',
        displayName: 'Theme Factory',
        oneLineDescription: 'Builds themes.',
        category: 'design',
        iconName: 'swatch',
        recommendedScope: 'both',
        version: '1.0.0',
      },
    ],
  }
}

describe('importAnthropicItems', () => {
  it('publishes every manifest item as a faithful zip with full provenance', async () => {
    await withTestCloudDatabase(async (db) => {
      const store = createInMemoryArtifactStore()
      const { items } = await importAnthropicItems(db, store, manifest())

      expect(items.map((i) => i.outcome)).toEqual(['published', 'published'])
      expect(items.every((i) => (i.bytes ?? 0) > 0)).toBe(true)

      // Provenance lands: anthropic-official publisher, pin-anchored
      // sourceUrl, the imported-from changelog.
      const canvas = await findItemWithPublisher(db, 'canvas-design')
      expect(canvas?.publisher.tier).toBe('anthropic-official')
      expect(canvas?.item.sourceUrl).toBe(`${fixtureRepo}/tree/${pinSha}/skills/canvas-design`)
      expect(canvas?.item.status).toBe('published')
      const version = await findItemVersion(db, { itemId: 'canvas-design', version: '1.0.0' })
      expect(version?.changelog).toBe(`imported from anthropics/skills@${pinSha.slice(0, 7)}`)

      // The stored zip is the folder, faithfully: SKILL.md at the root,
      // license + nested assets riding along, sha matching the DB facts.
      const stored = await store.get(artifactKey('canvas-design', '1.0.0'))
      expect(stored).not.toBeNull()
      expect(createHash('sha256').update(stored as Buffer).digest('hex')).toBe(
        version?.artifactSha256,
      )
      const zip = await JSZip.loadAsync(stored as Buffer)
      expect(await zip.file('SKILL.md')?.async('string')).toBe('canvas skill')
      expect(await zip.file('LICENSE.txt')?.async('string')).toBe('MIT')
      expect(await zip.file('assets/grid.css')?.async('string')).toBe('.g{}')
    })
  })

  it('re-runs as a no-op: everything skips, stored bytes stay untouched', async () => {
    await withTestCloudDatabase(async (db) => {
      const store = createInMemoryArtifactStore()
      await importAnthropicItems(db, store, manifest())
      const firstBytes = await store.get(artifactKey('theme-factory', '1.0.0'))

      const { items } = await importAnthropicItems(db, store, manifest())
      expect(items.map((i) => i.outcome)).toEqual([
        'skipped-already-published',
        'skipped-already-published',
      ])
      expect(items.every((i) => i.bytes === null)).toBe(true)
      expect(await store.get(artifactKey('theme-factory', '1.0.0'))).toEqual(firstBytes)
    })
  })

  it('skips a hand-published version and publishes the rest around it', async () => {
    await withTestCloudDatabase(async (db) => {
      const store = createInMemoryArtifactStore()
      const handBytes = await zipArtifact({ 'SKILL.md': 'hand-published earlier' })
      const input = manifest()
      await publishCatalogArtifact(db, store, {
        publisher: { ...input.publisher, url: input.publisher.url },
        item: {
          itemId: 'canvas-design',
          kind: 'skill',
          displayName: 'Canvas Design',
          oneLineDescription: 'Designs canvases.',
          category: 'design',
          iconName: 'palette',
          recommendedScope: 'user',
          minimumTier: 'basic',
          status: 'published',
        },
        version: { version: '1.0.0', changelog: 'manual', manifest: { entry: 'SKILL.md' } },
        artifactBytes: handBytes,
      })

      const { items } = await importAnthropicItems(db, store, input)
      expect(items.find((i) => i.itemId === 'canvas-design')?.outcome).toBe(
        'skipped-already-published',
      )
      expect(items.find((i) => i.itemId === 'theme-factory')?.outcome).toBe('published')
      // Byte-immutability: the import never re-zips over an existing version.
      expect(await store.get(artifactKey('canvas-design', '1.0.0'))).toEqual(handBytes)
    })
  })

  it('refuses an invalid manifest before touching git or the store', async () => {
    await withTestCloudDatabase(async (db) => {
      const bad = { ...manifest(), upstream: { repo: fixtureRepo, pinnedSha: 'abc123' } }
      await expect(
        importAnthropicItems(db, createInMemoryArtifactStore(), bad),
      ).rejects.toBeInstanceOf(ValidationError)
    })
  })
})
