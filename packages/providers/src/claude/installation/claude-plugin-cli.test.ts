// The plugin-CLI seam's parse + resolution logic over real files (temp home
// dir). The live CLI commands themselves are exercised by Chad's smoke —
// tests never mutate the real ~/.claude.

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  listInstalledClaudePlugins,
  resolveBundledClaudeBinary,
} from './claude-plugin-cli.js'

let home: string

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'vynel-plugin-cli-'))
  await mkdir(join(home, '.claude', 'plugins'), { recursive: true })
  await writeFile(
    join(home, '.claude', 'plugins', 'installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: {
        'document-skills@anthropic-agent-skills': [
          // Duplicate entries per key happen in real registries — the newest
          // (by lastUpdated) must win.
          { scope: 'user', version: 'unknown', installedAt: '2026-07-01T00:00:00Z' },
          {
            scope: 'user',
            version: '1.2.0',
            installedAt: '2026-08-01T00:00:00Z',
            lastUpdated: '2026-08-01T00:00:00Z',
          },
        ],
        'stripe@claude-plugins-official': [
          { scope: 'project', projectPath: 'E:\\somewhere', version: '0.2.5' },
        ],
        'not-a-valid-key': [{ scope: 'user', version: '1.0.0' }],
      },
    }),
  )
})

afterAll(async () => {
  await rm(home, { recursive: true, force: true })
})

describe('listInstalledClaudePlugins', () => {
  it('returns user-scope entries keyed name@marketplace, newest entry wins', () => {
    const plugins = listInstalledClaudePlugins(home)
    // test: correct expectation — Move C surfaces PROJECT-scope entries
    // too (with their projectPath); previously user-only.
    expect(plugins).toEqual([
      {
        key: 'document-skills@anthropic-agent-skills',
        pluginName: 'document-skills',
        marketplaceName: 'anthropic-agent-skills',
        version: '1.2.0',
        scope: 'user',
        projectPath: null,
      },
      {
        key: 'stripe@claude-plugins-official',
        pluginName: 'stripe',
        marketplaceName: 'claude-plugins-official',
        version: '0.2.5',
        scope: 'project',
        projectPath: 'E:\\somewhere',
      },
    ])
  })

  it('treats a missing registry as nothing installed', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'vynel-plugin-none-'))
    expect(listInstalledClaudePlugins(empty)).toEqual([])
    await rm(empty, { recursive: true, force: true })
  })
})

describe('resolveBundledClaudeBinary', () => {
  it('resolves an existing binary from the SDK platform package', () => {
    const binary = resolveBundledClaudeBinary()
    expect(existsSync(binary)).toBe(true)
    expect(binary.toLowerCase()).toContain('claude-agent-sdk')
  })
})

// The repo-mismatch guard across BOTH registration shapes (Move A's
// must-fix): a shorthand-registered marketplace must accept its own
// rendered https URL, a genuinely different origin must refuse BEFORE any
// exec, and a blank caller-side ref skips the check (the registration is
// the anchor). Guard-passing cases proceed to the real exec against
// process.execPath (node), whose failure message proves the mismatch
// guard did NOT fire.
import { canonicalMarketplaceRef, installClaudePlugin } from './claude-plugin-cli.js'
import { ValidationError } from '@vynel/errors'

describe('canonicalMarketplaceRef', () => {
  it('folds owner/repo, its https URL, .git and trailing slashes together', () => {
    for (const spelling of [
      'anthropics/skills',
      'https://github.com/anthropics/skills',
      'https://github.com/anthropics/skills.git',
      'https://github.com/Anthropics/Skills.git/',
    ]) {
      expect(canonicalMarketplaceRef(spelling)).toBe('anthropics/skills')
    }
    expect(canonicalMarketplaceRef('https://gitlab.com/a/b.git')).toBe('https://gitlab.com/a/b')
  })
})

describe('installClaudePlugin — registration guard', () => {
  let guardHome: string

  beforeAll(async () => {
    guardHome = await mkdtemp(join(tmpdir(), 'vynel-plugin-guard-'))
    await mkdir(join(guardHome, '.claude', 'plugins'), { recursive: true })
    await writeFile(
      join(guardHome, '.claude', 'plugins', 'known_marketplaces.json'),
      JSON.stringify({
        'shorthand-mkt': { source: { source: 'github', repo: 'acme/tools' } },
        'url-mkt': { source: { source: 'git', url: 'https://github.com/acme/other.git' } },
      }),
    )
  })

  afterAll(async () => {
    await rm(guardHome, { recursive: true, force: true })
  })

  it('accepts the rendered https URL for a shorthand-registered marketplace (guard passes, exec fails downstream)', async () => {
    await expect(
      installClaudePlugin({
        marketplaceRepo: 'https://github.com/acme/tools',
        marketplaceName: 'shorthand-mkt',
        pluginName: 'invoicer',
        binaryPath: process.execPath,
        homeDir: guardHome,
      }),
    ).rejects.toThrow(/The Claude plugin command failed/)
  })

  it('refuses a genuinely different origin before any exec', async () => {
    await expect(
      installClaudePlugin({
        marketplaceRepo: 'https://github.com/evil/tools.git',
        marketplaceName: 'shorthand-mkt',
        pluginName: 'invoicer',
        homeDir: guardHome,
      }),
    ).rejects.toThrow(/already registered from/)
    await expect(
      installClaudePlugin({
        marketplaceRepo: 'https://github.com/evil/other.git',
        marketplaceName: 'url-mkt',
        pluginName: 'invoicer',
        homeDir: guardHome,
      }),
    ).rejects.toThrow(/already registered from/)
  })

  it('a blank caller-side ref skips the check (registration is the anchor)', async () => {
    await expect(
      installClaudePlugin({
        marketplaceRepo: '',
        marketplaceName: 'url-mkt',
        pluginName: 'invoicer',
        binaryPath: process.execPath,
        homeDir: guardHome,
      }),
    ).rejects.toThrow(/The Claude plugin command failed/)
  })

  it('refuses a dash-leading plugin name before touching the CLI', async () => {
    await expect(
      installClaudePlugin({
        marketplaceRepo: '',
        marketplaceName: 'url-mkt',
        pluginName: '-evil',
        homeDir: guardHome,
      }),
    ).rejects.toThrow(ValidationError)
  })
})
