// Publish-from-repo end-to-end against a REAL local git fixture over PGlite
// + the in-memory store. The URL wall is absolute (github.com https only),
// so the git deps seam maps the github-shaped URL onto the fixture path
// while everything else — resolve, clone, pack, inspect, publish, sign —
// runs the real code.

import { createHash, generateKeyPairSync } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { withTestCloudDatabase } from '@vynel/cloud-db/testing'
import { ConflictError, NotFoundError, ValidationError } from '@vynel/errors'
import { verifyArtifactSha256Signature } from '@vynel/contracts/hub/artifact-signing'
import { publishCatalogItemFromRepo, type PublishFromRepoInput } from './publish-from-repo.js'
import { publishCatalogArtifact } from './publish-catalog-artifact.js'
import { createArtifactSigner } from './artifact-signer.js'
import { artifactKey, createInMemoryArtifactStore } from './artifact-store.js'
import { findItemVersion, findItemWithPublisher } from './repositories/catalog-repository.js'
import { cloneRepoAtPin, resolveRepoRefToSha } from './git-fetch.js'
import { zipArtifact } from './testing.js'
import type { RepoGitDeps } from './repo-source.js'

const REPO_URL = 'https://github.com/acme/agent-tools'

let fixtureRepo: string
let pinSha: string

function gitIn(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
}

beforeAll(() => {
  fixtureRepo = mkdtempSync(join(tmpdir(), 'vynel-repo-publish-fixture-'))
  execFileSync('git', ['init', '--initial-branch=main', fixtureRepo], { encoding: 'utf8' })
  gitIn(fixtureRepo, ['config', 'user.email', 'test@test'])
  gitIn(fixtureRepo, ['config', 'user.name', 'test'])

  mkdirSync(join(fixtureRepo, 'bundles', 'email-drafter', 'assets'), { recursive: true })
  writeFileSync(join(fixtureRepo, 'bundles', 'email-drafter', 'SKILL.md'), '# drafts', 'utf8')
  writeFileSync(join(fixtureRepo, 'bundles', 'email-drafter', 'assets', 'tone.md'), 'warm', 'utf8')
  writeFileSync(
    join(fixtureRepo, 'bundles', 'email-drafter', 'vynel-item.json'),
    '{"item":{"itemId":"email-drafter"}}',
    'utf8',
  )
  mkdirSync(join(fixtureRepo, 'bundles', 'focus-writer'), { recursive: true })
  writeFileSync(join(fixtureRepo, 'bundles', 'focus-writer', 'agent.json'), '{"slug":"fw"}', 'utf8')
  gitIn(fixtureRepo, ['add', '.'])
  gitIn(fixtureRepo, ['commit', '-m', 'pin'])
  pinSha = gitIn(fixtureRepo, ['rev-parse', 'HEAD'])
})

afterAll(() => {
  rmSync(fixtureRepo, { recursive: true, force: true })
})

// Real git functions, github URL swapped for the fixture path.
const fixtureDeps: RepoGitDeps = {
  resolveRefToSha: (_repo, ref) => resolveRepoRefToSha(fixtureRepo, ref),
  cloneAtPin: (_repo, sha, dir) => cloneRepoAtPin(fixtureRepo, sha, dir),
}

// Deps that prove no git ever ran (fail-before-network assertions).
const neverGitDeps: RepoGitDeps = {
  resolveRefToSha: () => Promise.reject(new Error('git must not run')),
  cloneAtPin: () => Promise.reject(new Error('git must not run')),
}

function input(over: Partial<PublishFromRepoInput['item']> = {}): PublishFromRepoInput {
  return {
    publisher: { id: 'acme', name: 'Acme', tier: 'community', url: 'https://acme.dev' },
    item: {
      itemId: 'email-drafter',
      kind: 'skill',
      displayName: 'Email Drafter',
      oneLineDescription: 'Drafts emails.',
      category: 'email',
      iconName: 'mail',
      recommendedScope: 'user',
      minimumTier: 'basic',
      status: 'published',
      ...over,
    },
    version: { version: '1.0.0', changelog: 'from repo', manifest: { entry: 'SKILL.md' } },
    repo: { url: REPO_URL, ref: 'main', subpath: 'bundles/email-drafter' },
  }
}

describe('publishCatalogItemFromRepo', () => {
  it('resolves the branch to a pin, packs the folder (metadata excluded), and publishes with a derived sourceUrl', async () => {
    await withTestCloudDatabase(async (db) => {
      const store = createInMemoryArtifactStore()
      const result = await publishCatalogItemFromRepo(
        db,
        store,
        input(),
        undefined,
        fixtureDeps,
      )

      expect(result.resolvedSha).toBe(pinSha)
      expect(result.sourceUrl).toBe(`${REPO_URL}/tree/${pinSha}/bundles/email-drafter`)
      expect(result.bytes).toBeGreaterThan(0)

      const published = await findItemWithPublisher(db, 'email-drafter')
      expect(published?.publisher.tier).toBe('community')
      expect(published?.publisher.url).toBe('https://acme.dev')
      expect(published?.item.sourceUrl).toBe(result.sourceUrl)

      const version = await findItemVersion(db, { itemId: 'email-drafter', version: '1.0.0' })
      const stored = await store.get(artifactKey('email-drafter', '1.0.0'))
      expect(stored).not.toBeNull()
      expect(createHash('sha256').update(stored as Buffer).digest('hex')).toBe(
        version?.artifactSha256,
      )
      const zip = await JSZip.loadAsync(stored as Buffer)
      expect(await zip.file('SKILL.md')?.async('string')).toBe('# drafts')
      expect(await zip.file('assets/tone.md')?.async('string')).toBe('warm')
      // The bundle metadata never rides inside the artifact.
      expect(zip.file('vynel-item.json')).toBeNull()
    })
  })

  it('respects an explicit sourceUrl and signs when the hub carries a key', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const signer = createArtifactSigner(
      privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    )
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    await withTestCloudDatabase(async (db) => {
      const store = createInMemoryArtifactStore()
      const explicit = 'https://github.com/acme/agent-tools/tree/main/bundles/focus-writer'
      const result = await publishCatalogItemFromRepo(
        db,
        store,
        {
          ...input({ itemId: 'focus-writer', kind: 'agent', sourceUrl: explicit }),
          version: { version: '2.0.0', changelog: '', manifest: { entryFile: 'agent.json' } },
          repo: { url: REPO_URL, ref: pinSha, subpath: 'bundles/focus-writer' },
        },
        signer,
        fixtureDeps,
      )
      expect(result.sourceUrl).toBe(explicit)

      const version = await findItemVersion(db, { itemId: 'focus-writer', version: '2.0.0' })
      expect(version?.artifactSignature).not.toBeNull()
      expect(
        verifyArtifactSha256Signature(
          publicPem,
          version?.artifactSha256 ?? '',
          version?.artifactSignature ?? '',
        ),
      ).toBe(true)
    })
  })

  it('refuses every non-github source before any git runs', async () => {
    await withTestCloudDatabase(async (db) => {
      const store = createInMemoryArtifactStore()
      for (const url of [
        'file:///etc/passwd',
        'ssh://git@github.com/acme/tools',
        'git://github.com/acme/tools',
        'http://github.com/acme/tools',
        'https://gitlab.com/acme/tools',
        'https://user:secret@github.com/acme/tools',
        'https://github.com:8443/acme/tools',
        'not a url',
      ]) {
        await expect(
          publishCatalogItemFromRepo(
            db,
            store,
            { ...input(), repo: { url, subpath: 'x' } },
            undefined,
            neverGitDeps,
          ),
        ).rejects.toBeInstanceOf(ValidationError)
      }
    })
  })

  it('refuses a traversing subpath and 404s a missing folder / unknown ref', async () => {
    await withTestCloudDatabase(async (db) => {
      const store = createInMemoryArtifactStore()
      await expect(
        publishCatalogItemFromRepo(
          db,
          store,
          { ...input(), repo: { url: REPO_URL, subpath: '../outside' } },
          undefined,
          fixtureDeps,
        ),
      ).rejects.toBeInstanceOf(ValidationError)

      await expect(
        publishCatalogItemFromRepo(
          db,
          store,
          { ...input(), repo: { url: REPO_URL, ref: 'main', subpath: 'bundles/ghost' } },
          undefined,
          fixtureDeps,
        ),
      ).rejects.toBeInstanceOf(NotFoundError)

      await expect(
        publishCatalogItemFromRepo(
          db,
          store,
          { ...input(), repo: { url: REPO_URL, ref: 'no-such-branch', subpath: 'bundles/email-drafter' } },
          undefined,
          fixtureDeps,
        ),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  it('refuses a folder without the kind entry file', async () => {
    await withTestCloudDatabase(async (db) => {
      await expect(
        publishCatalogItemFromRepo(
          db,
          createInMemoryArtifactStore(),
          // focus-writer has agent.json, not SKILL.md — a skill publish must refuse.
          { ...input(), repo: { url: REPO_URL, ref: 'main', subpath: 'bundles/focus-writer' } },
          undefined,
          fixtureDeps,
        ),
      ).rejects.toMatchObject({ message: expect.stringContaining('no root SKILL.md') })
    })
  })

  it('conflicts on an already-published version WITHOUT cloning', async () => {
    await withTestCloudDatabase(async (db) => {
      const store = createInMemoryArtifactStore()
      await publishCatalogArtifact(db, store, {
        ...input(),
        artifactBytes: await zipArtifact({ 'SKILL.md': 'existing' }),
      })
      await expect(
        publishCatalogItemFromRepo(db, store, input(), undefined, neverGitDeps),
      ).rejects.toBeInstanceOf(ConflictError)
    })
  })
})
