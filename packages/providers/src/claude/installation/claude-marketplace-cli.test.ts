// The marketplace-cli seam's parse logic over real files (temp home +
// temp clone dir). The live CLI commands are Chad's smoke — tests never
// mutate the real ~/.claude. The write commands' shared guard is pinned
// here too (the exec path itself rides the plugin runner, already covered).

import { mkdir, rm, writeFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { ValidationError } from '@vynel/errors'
import {
  addClaudeMarketplace,
  listKnownClaudeMarketplaces,
  readClaudeMarketplaceCatalog,
  removeClaudeMarketplace,
} from './claude-marketplace-cli.js'

let home: string
let cloneDir: string

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'vynel-mkt-cli-'))
  cloneDir = join(home, '.claude', 'plugins', 'marketplaces', 'acme-tools')
  await mkdir(join(home, '.claude', 'plugins'), { recursive: true })
  await writeFile(
    join(home, '.claude', 'plugins', 'known_marketplaces.json'),
    JSON.stringify({
      'acme-tools': {
        source: { source: 'git', url: 'https://github.com/acme/tools.git' },
        installLocation: cloneDir,
        lastUpdated: '2026-08-09T00:00:00.000Z',
      },
      // The OTHER registration shape real registries carry.
      'anthropic-agent-skills': {
        source: { source: 'github', repo: 'anthropics/skills' },
        installLocation: join(home, '.claude', 'plugins', 'marketplaces', 'anthropic-agent-skills'),
      },
      'broken-entry': 42,
    }),
  )
  await mkdir(join(cloneDir, '.claude-plugin'), { recursive: true })
  await writeFile(
    join(cloneDir, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: 'acme-tools',
      owner: { name: 'Acme Inc' },
      metadata: { description: 'Acme plugins', version: '2.0.0' },
      plugins: [
        { name: 'invoicer', description: 'Invoices', version: '1.1.0', category: 'business' },
        { name: 'versionless-plugin', description: null },
        { nope: true },
      ],
    }),
  )
})

afterAll(async () => {
  await rm(home, { recursive: true, force: true })
})

describe('listKnownClaudeMarketplaces', () => {
  it('maps both registration shapes and skips malformed entries gracefully', () => {
    const known = listKnownClaudeMarketplaces(home)
    expect(known).toEqual([
      {
        marketplaceName: 'acme-tools',
        sourceUrl: 'https://github.com/acme/tools.git',
        installLocation: cloneDir,
        lastUpdated: '2026-08-09T00:00:00.000Z',
      },
      {
        marketplaceName: 'anthropic-agent-skills',
        sourceUrl: 'https://github.com/anthropics/skills',
        installLocation: join(home, '.claude', 'plugins', 'marketplaces', 'anthropic-agent-skills'),
        lastUpdated: null,
      },
      { marketplaceName: 'broken-entry', sourceUrl: null, installLocation: null, lastUpdated: null },
    ])
  })

  it('answers empty on a missing registry file', () => {
    expect(listKnownClaudeMarketplaces(join(tmpdir(), 'nope-never-here'))).toEqual([])
  })
})

describe('readClaudeMarketplaceCatalog', () => {
  it('reads plugins with per-plugin version falling back to marketplace metadata', () => {
    const catalog = readClaudeMarketplaceCatalog('acme-tools', cloneDir)
    expect(catalog).toEqual({
      marketplaceName: 'acme-tools',
      ownerName: 'Acme Inc',
      description: 'Acme plugins',
      plugins: [
        { pluginName: 'invoicer', description: 'Invoices', version: '1.1.0', category: 'business' },
        // Per-plugin version only — the marketplace metadata.version is a
        // different fact (borrowing it fabricated phantom Updates).
        { pluginName: 'versionless-plugin', description: null, version: null, category: null },
      ],
    })
  })

  it('answers null on a missing or shapeless catalog file', () => {
    expect(readClaudeMarketplaceCatalog('gone', join(tmpdir(), 'nope-never-here'))).toBeNull()
  })
})

describe('write-command argv guard', () => {
  it('refuses empty or dash-leading arguments before any process spawns', async () => {
    await expect(addClaudeMarketplace({ sourceUrl: '--evil' })).rejects.toThrow(ValidationError)
    await expect(removeClaudeMarketplace({ marketplaceName: ' ' })).rejects.toThrow(
      ValidationError,
    )
  })
})
