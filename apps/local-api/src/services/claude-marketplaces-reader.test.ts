// The composition semantic this file owns: a registered-but-unreadable
// marketplace (clone gone, malformed catalog) still LISTS as a source with
// zero plugins — the manage dialog must show it for removal, while the
// shelf mapper's flatMap gives it no rows.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { listClaudeMarketplaceSources } from './claude-marketplaces-reader.js'

let home: string

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'vynel-mkt-reader-'))
  const readableClone = join(home, '.claude', 'plugins', 'marketplaces', 'readable')
  await mkdir(join(readableClone, '.claude-plugin'), { recursive: true })
  await writeFile(
    join(readableClone, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: 'readable',
      owner: { name: 'Acme' },
      plugins: [{ name: 'invoicer', description: 'x' }],
    }),
  )
  await writeFile(
    join(home, '.claude', 'plugins', 'known_marketplaces.json'),
    JSON.stringify({
      readable: {
        source: { source: 'git', url: 'https://github.com/acme/tools.git' },
        installLocation: readableClone,
      },
      'clone-gone': {
        source: { source: 'git', url: 'https://github.com/acme/gone.git' },
        installLocation: join(home, 'nope'),
      },
    }),
  )
})

afterAll(async () => {
  await rm(home, { recursive: true, force: true })
})

describe('listClaudeMarketplaceSources', () => {
  it('lists readable sources with plugins and unreadable ones with none', () => {
    const sources = listClaudeMarketplaceSources(home)
    expect(sources).toEqual([
      {
        marketplaceName: 'readable',
        sourceUrl: 'https://github.com/acme/tools.git',
        ownerName: 'Acme',
        plugins: [
          { pluginName: 'invoicer', description: 'x', version: null, category: null },
        ],
      },
      {
        marketplaceName: 'clone-gone',
        sourceUrl: 'https://github.com/acme/gone.git',
        ownerName: null,
        plugins: [],
      },
    ])
  })
})
