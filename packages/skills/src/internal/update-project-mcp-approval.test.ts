// The project-approval record — `<workspace>/.claude/settings.local.json`
// `enabledMcpjsonServers`/`disabledMcpjsonServers` (the location the CLI
// actually reads, probed live 2026-08-09) — over a real temp workspace:
// approval clears a prior rejection (rejection outranks otherwise), revoke
// clears only the approval, and every unrelated settings key survives.

import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  approveProjectMcpjsonServer,
  revokeProjectMcpjsonServerApproval,
} from './update-project-mcp-approval.js'

async function withTempWorkspace<T>(fn: (workspacePath: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'vynel-mcp-approval-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function readSettings(workspacePath: string): Record<string, any> {
  return JSON.parse(
    readFileSync(join(workspacePath, '.claude', 'settings.local.json'), 'utf8'),
  )
}

describe('approveProjectMcpjsonServer', () => {
  it('creates the settings file when absent; approval is idempotent', async () => {
    await withTempWorkspace(async (workspacePath) => {
      await approveProjectMcpjsonServer(workspacePath, 'notion')
      await approveProjectMcpjsonServer(workspacePath, 'notion')
      expect(readSettings(workspacePath).enabledMcpjsonServers).toEqual(['notion'])
    })
  })

  it('clears a prior REJECTION (rejection outranks approval) and preserves other keys', async () => {
    await withTempWorkspace(async (workspacePath) => {
      mkdirSync(join(workspacePath, '.claude'), { recursive: true })
      writeFileSync(
        join(workspacePath, '.claude', 'settings.local.json'),
        JSON.stringify({
          permissions: { allow: ['Bash(npm:*)'] },
          disabledMcpjsonServers: ['playwright', 'notion'],
          enabledMcpjsonServers: [],
        }),
        'utf8',
      )

      await approveProjectMcpjsonServer(workspacePath, 'notion')

      expect(readSettings(workspacePath)).toEqual({
        permissions: { allow: ['Bash(npm:*)'] },
        // Another server's rejection is not ours to clear.
        disabledMcpjsonServers: ['playwright'],
        enabledMcpjsonServers: ['notion'],
      })
    })
  })

  it('revoke clears ONLY the approval — an uninstall is not a rejection', async () => {
    await withTempWorkspace(async (workspacePath) => {
      await approveProjectMcpjsonServer(workspacePath, 'notion')
      await revokeProjectMcpjsonServerApproval(workspacePath, 'notion')
      const settings = readSettings(workspacePath)
      expect(settings.enabledMcpjsonServers).toEqual([])
      expect(settings.disabledMcpjsonServers).toBeUndefined()
    })
  })

  it('revoke on a workspace without a settings file invents nothing', async () => {
    await withTempWorkspace(async (workspacePath) => {
      await revokeProjectMcpjsonServerApproval(workspacePath, 'notion')
      expect(existsSync(join(workspacePath, '.claude', 'settings.local.json'))).toBe(false)
    })
  })

  it('refuses to clobber a malformed settings file', async () => {
    await withTempWorkspace(async (workspacePath) => {
      mkdirSync(join(workspacePath, '.claude'), { recursive: true })
      writeFileSync(join(workspacePath, '.claude', 'settings.local.json'), '{ not json', 'utf8')
      await expect(approveProjectMcpjsonServer(workspacePath, 'notion')).rejects.toThrow(
        /malformed JSON/i,
      )
      expect(
        readFileSync(join(workspacePath, '.claude', 'settings.local.json'), 'utf8'),
      ).toBe('{ not json')
    })
  })
})
