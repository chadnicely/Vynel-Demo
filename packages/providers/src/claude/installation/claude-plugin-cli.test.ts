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
    expect(plugins).toEqual([
      {
        key: 'document-skills@anthropic-agent-skills',
        pluginName: 'document-skills',
        marketplaceName: 'anthropic-agent-skills',
        version: '1.2.0',
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
