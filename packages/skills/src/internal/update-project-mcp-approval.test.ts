// The project-approval record (`projects[<path>].enabledMcpjsonServers` in
// ~/.claude.json) over a real temp home: path-spelling variants all update,
// a missing entry is created native-form, an earlier rejection is cleared
// by explicit consent, and every unrelated key survives verbatim.

import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withHomeDir } from './resolve-host-home-dir.js'
import {
  approveProjectMcpjsonServer,
  revokeProjectMcpjsonServerApproval,
} from './update-project-mcp-approval.js'

async function withIsolatedHome<T>(fn: (homeDir: string) => Promise<T>): Promise<T> {
  const homeDir = mkdtempSync(join(tmpdir(), 'vynel-mcp-approval-'))
  try {
    return await withHomeDir(homeDir, () => fn(homeDir))
  } finally {
    rmSync(homeDir, { recursive: true, force: true })
  }
}

function readConfig(homeDir: string): Record<string, any> {
  return JSON.parse(readFileSync(join(homeDir, '.claude.json'), 'utf8'))
}

describe('approveProjectMcpjsonServer', () => {
  it('updates EVERY path-spelling variant of the workspace and clears a prior rejection', async () => {
    await withIsolatedHome(async (homeDir) => {
      writeFileSync(
        join(homeDir, '.claude.json'),
        JSON.stringify({
          theme: 'dark',
          projects: {
            'C:\\Users\\T\\ws': {
              allowedTools: ['Bash'],
              enabledMcpjsonServers: [],
              disabledMcpjsonServers: ['notion'],
            },
            'c:/users/t/ws': { enabledMcpjsonServers: ['other'] },
            'C:\\Users\\T\\unrelated': { enabledMcpjsonServers: [] },
          },
        }),
        'utf8',
      )

      await approveProjectMcpjsonServer('C:\\Users\\T\\ws', 'notion')

      const config = readConfig(homeDir)
      expect(config.theme).toBe('dark')
      expect(config.projects['C:\\Users\\T\\ws']).toEqual({
        allowedTools: ['Bash'],
        enabledMcpjsonServers: ['notion'],
        disabledMcpjsonServers: [],
      })
      expect(config.projects['c:/users/t/ws'].enabledMcpjsonServers).toEqual(['other', 'notion'])
      expect(config.projects['C:\\Users\\T\\unrelated'].enabledMcpjsonServers).toEqual([])
    })
  })

  it('creates the native-form project entry when none exists; approval is idempotent', async () => {
    await withIsolatedHome(async (homeDir) => {
      await approveProjectMcpjsonServer('D:\\my ws', 'notion')
      await approveProjectMcpjsonServer('D:\\my ws', 'notion')
      const config = readConfig(homeDir)
      expect(config.projects['D:\\my ws'].enabledMcpjsonServers).toEqual(['notion'])
    })
  })

  it('revoke removes the approval without inventing entries', async () => {
    await withIsolatedHome(async (homeDir) => {
      await approveProjectMcpjsonServer('D:\\my ws', 'notion')
      await revokeProjectMcpjsonServerApproval('D:\\my ws', 'notion')
      await revokeProjectMcpjsonServerApproval('D:\\other', 'notion')
      const config = readConfig(homeDir)
      expect(config.projects['D:\\my ws'].enabledMcpjsonServers).toEqual([])
      expect(config.projects['D:\\other']).toBeUndefined()
    })
  })

  it('refuses to clobber a malformed config', async () => {
    await withIsolatedHome(async (homeDir) => {
      writeFileSync(join(homeDir, '.claude.json'), '{ not json', 'utf8')
      await expect(approveProjectMcpjsonServer('D:\\ws', 'notion')).rejects.toThrow(
        /malformed JSON/i,
      )
      expect(readFileSync(join(homeDir, '.claude.json'), 'utf8')).toBe('{ not json')
    })
  })
})
