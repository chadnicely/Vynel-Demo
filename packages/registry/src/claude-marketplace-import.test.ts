// Inspect + approve-import for Claude-native marketplaces over a REAL local
// git fixture + PGlite (the publish-from-repo harness pattern: github-shaped
// URL, git deps mapped onto the fixture). Pins desktop compatibility too —
// the published manifest must parse with the SAME parser the desktop's
// install path uses.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { withTestCloudDatabase } from '@vynel/cloud-db/testing'
import { ValidationError } from '@vynel/errors'
import { parsePluginItemManifest } from '@vynel/contracts/marketplace/plugin-item-manifest'
import {
  importClaudeMarketplacePlugins,
  inspectClaudeMarketplaceRepo,
  proposedPluginItemId,
} from './claude-marketplace-import.js'
import { createInMemoryArtifactStore } from './artifact-store.js'
import { findItemWithPublisher, findLatestVersionForItem } from './repositories/catalog-repository.js'
import { cloneRepoAtPin, resolveRepoRefToSha } from './git-fetch.js'
import type { RepoGitDeps } from './repo-source.js'

const REPO_URL = 'https://github.com/acme/tools'

let fixtureRepo: string
let pinSha: string

function gitIn(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
}

beforeAll(() => {
  fixtureRepo = mkdtempSync(join(tmpdir(), 'vynel-mkt-import-fixture-'))
  execFileSync('git', ['init', '--initial-branch=main', fixtureRepo], { encoding: 'utf8' })
  gitIn(fixtureRepo, ['config', 'user.email', 'test@test'])
  gitIn(fixtureRepo, ['config', 'user.name', 'test'])
  mkdirSync(join(fixtureRepo, '.claude-plugin'), { recursive: true })
  writeFileSync(
    join(fixtureRepo, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: 'acme-tools',
      owner: { name: 'Acme Inc' },
      metadata: { description: 'Acme plugins', version: '2.0.0' },
      plugins: [
        { name: 'invoicer', description: 'Invoices', version: '1.1.0', category: 'business' },
        { name: 'My Fancy Plugin!', description: null },
        { nope: true },
      ],
    }),
    'utf8',
  )
  gitIn(fixtureRepo, ['add', '.'])
  gitIn(fixtureRepo, ['commit', '-m', 'pin'])
  pinSha = gitIn(fixtureRepo, ['rev-parse', 'HEAD'])
})

afterAll(() => {
  rmSync(fixtureRepo, { recursive: true, force: true })
})

const fixtureDeps: RepoGitDeps = {
  resolveRefToSha: (_repo, ref) => resolveRepoRefToSha(fixtureRepo, ref),
  cloneAtPin: (_repo, sha, dir) => cloneRepoAtPin(fixtureRepo, sha, dir),
}

const neverGitDeps: RepoGitDeps = {
  resolveRefToSha: () => Promise.reject(new Error('git must not run')),
  cloneAtPin: () => Promise.reject(new Error('git must not run')),
}

describe('proposedPluginItemId', () => {
  it('folds arbitrary names into the kebab id space', () => {
    expect(proposedPluginItemId('acme-tools', 'My Fancy Plugin!')).toBe(
      'acme-tools-my-fancy-plugin',
    )
    expect(proposedPluginItemId('***', '!!!')).toBeNull()
  })
})

describe('inspectClaudeMarketplaceRepo', () => {
  it('answers the pinned plugin list with proposed ids; the URL wall runs before git', async () => {
    await withTestCloudDatabase(async (db) => {
      const inspection = await inspectClaudeMarketplaceRepo(db, { url: REPO_URL }, fixtureDeps)
      expect(inspection).toMatchObject({
        repoUrl: REPO_URL,
        pinnedSha: pinSha,
        marketplaceName: 'acme-tools',
        ownerName: 'Acme Inc',
        description: 'Acme plugins',
      })
      expect(inspection.plugins).toEqual([
        {
          pluginName: 'invoicer',
          description: 'Invoices',
          version: '1.1.0',
          category: 'business',
          proposedItemId: 'acme-tools-invoicer',
          alreadyPublished: false,
        },
        {
          pluginName: 'My Fancy Plugin!',
          description: null,
          version: '2.0.0',
          category: null,
          proposedItemId: 'acme-tools-my-fancy-plugin',
          alreadyPublished: false,
        },
      ])

      await expect(
        inspectClaudeMarketplaceRepo(db, { url: 'https://evil.example/repo' }, neverGitDeps),
      ).rejects.toThrow(ValidationError)
    })
  })
})

describe('importClaudeMarketplacePlugins', () => {
  it('publishes approved plugins as community delegate items the desktop can parse', async () => {
    await withTestCloudDatabase(async (db) => {
      const store = createInMemoryArtifactStore()
      const { items } = await importClaudeMarketplacePlugins(db, store, {
        url: REPO_URL,
        pinnedSha: pinSha,
        marketplaceName: 'acme-tools',
        ownerName: 'Acme Inc',
        selected: [
          { pluginName: 'invoicer', description: 'Invoices', version: '1.1.0', category: 'business' },
        ],
      })
      expect(items).toEqual([
        { itemId: 'acme-tools-invoicer', pluginName: 'invoicer', outcome: 'published', detail: null },
      ])

      const published = await findItemWithPublisher(db, 'acme-tools-invoicer')
      expect(published?.item).toMatchObject({
        kind: 'plugin',
        status: 'published',
        sourceUrl: `${REPO_URL}/tree/${pinSha}`,
      })
      // Namespaced id — a marketplace name can never fold onto an existing
      // curated publisher (the anthropic-impersonation demotion class).
      expect(published?.publisher).toMatchObject({
        id: 'mkt-acme-tools',
        name: 'Acme Inc',
        tier: 'community',
      })

      // Desktop compatibility: the SAME parser the install path uses.
      const version = await findLatestVersionForItem(db, 'acme-tools-invoicer')
      expect(parsePluginItemManifest(version!.manifestJson)).toEqual({
        marketplaceRepo: REPO_URL,
        marketplaceName: 'acme-tools',
        pluginName: 'invoicer',
      })

      // Idempotent approve-again → skip; hostile name → invalid-name.
      const rerun = await importClaudeMarketplacePlugins(db, store, {
        url: REPO_URL,
        pinnedSha: pinSha,
        marketplaceName: 'acme-tools',
        ownerName: 'Acme Inc',
        selected: [
          { pluginName: 'invoicer', description: null, version: '1.1.0', category: null },
          { pluginName: '!!!', description: null, version: null, category: null },
        ],
      })
      expect(rerun.items.map((item) => item.outcome)).toEqual([
        'skipped-already-published',
        'invalid-name',
      ])

      // Re-inspection reflects the published state (the review queue's
      // "already on the shelf" signal).
      const inspection = await inspectClaudeMarketplaceRepo(db, { url: REPO_URL }, fixtureDeps)
      expect(inspection.plugins.find((plugin) => plugin.pluginName === 'invoicer')).toMatchObject({
        alreadyPublished: true,
      })
    })
  })
})

// Hostile-metadata hardening (review round): the review material truncates
// to publishable bounds, dedupes, and caps; import re-validates with the
// REAL publish schema per item — one bad plugin never aborts the batch.
describe('hostile marketplace.json hardening', () => {
  it('inspection truncates fields, dedupes names, and caps the list', async () => {
    const hostileRepo = mkdtempSync(join(tmpdir(), 'vynel-mkt-hostile-'))
    try {
      execFileSync('git', ['init', '--initial-branch=main', hostileRepo], { encoding: 'utf8' })
      gitIn(hostileRepo, ['config', 'user.email', 'test@test'])
      gitIn(hostileRepo, ['config', 'user.name', 'test'])
      mkdirSync(join(hostileRepo, '.claude-plugin'), { recursive: true })
      writeFileSync(
        join(hostileRepo, '.claude-plugin', 'marketplace.json'),
        JSON.stringify({
          name: 'hostile',
          plugins: [
            { name: 'dup', description: 'x'.repeat(1000) },
            { name: 'dup', description: 'second copy' },
            ...Array.from({ length: 150 }, (_, index) => ({ name: `filler-${index}` })),
          ],
        }),
        'utf8',
      )
      gitIn(hostileRepo, ['add', '.'])
      gitIn(hostileRepo, ['commit', '-m', 'pin'])
      const hostileDeps: RepoGitDeps = {
        resolveRefToSha: (_repo, ref) => resolveRepoRefToSha(hostileRepo, ref),
        cloneAtPin: (_repo, sha, dir) => cloneRepoAtPin(hostileRepo, sha, dir),
      }
      await withTestCloudDatabase(async (db) => {
        const inspection = await inspectClaudeMarketplaceRepo(
          db,
          { url: REPO_URL },
          hostileDeps,
        )
        expect(inspection.plugins).toHaveLength(100)
        const dup = inspection.plugins.find((plugin) => plugin.pluginName === 'dup')!
        expect(dup.description).toHaveLength(280)
        expect(
          inspection.plugins.filter((plugin) => plugin.pluginName === 'dup'),
        ).toHaveLength(1)
      })
    } finally {
      rmSync(hostileRepo, { recursive: true, force: true })
    }
  })

  it('import refuses non-semver versions per item without aborting the batch', async () => {
    await withTestCloudDatabase(async (db) => {
      const store = createInMemoryArtifactStore()
      const { items } = await importClaudeMarketplacePlugins(db, store, {
        url: REPO_URL,
        pinnedSha: pinSha,
        marketplaceName: 'acme-tools',
        ownerName: 'Acme Inc',
        selected: [
          { pluginName: 'bad-version', description: null, version: 'latest', category: null },
          { pluginName: 'good', description: null, version: '1.0.0', category: null },
        ],
      })
      expect(items.map((item) => item.outcome)).toEqual(['invalid-metadata', 'published'])
      expect(items[0]!.detail).toBeTruthy()
    })
  })
})
