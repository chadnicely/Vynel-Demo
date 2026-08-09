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

// The trust half: approval also records folder trust in ~/.claude.json,
// keyed by the FORWARD-SLASH spelling (backslash keys are invisible to
// the CLI — probed live), preserving an existing entry's other keys.
import { withHomeDir } from './resolve-host-home-dir.js'

async function withIsolatedHomeAndWorkspace<T>(
  fn: (homeDir: string, workspacePath: string) => Promise<T>,
): Promise<T> {
  const homeDir = mkdtempSync(join(tmpdir(), 'vynel-mcp-trust-home-'))
  const workspacePath = mkdtempSync(join(tmpdir(), 'vynel-mcp-trust-ws-'))
  try {
    return await withHomeDir(homeDir, () => fn(homeDir, workspacePath))
  } finally {
    rmSync(homeDir, { recursive: true, force: true })
    rmSync(workspacePath, { recursive: true, force: true })
  }
}

describe('approval records folder trust', () => {
  it('writes hasTrustDialogAccepted under the forward-slash key, preserving other keys', async () => {
    await withIsolatedHomeAndWorkspace(async (homeDir, workspacePath) => {
      const forwardKey = workspacePath.replaceAll('\\', '/')
      writeFileSync(
        join(homeDir, '.claude.json'),
        JSON.stringify({
          theme: 'dark',
          projects: { [forwardKey]: { allowedTools: ['Bash'] } },
        }),
        'utf8',
      )

      await approveProjectMcpjsonServer(workspacePath, 'notion')

      const config = JSON.parse(readFileSync(join(homeDir, '.claude.json'), 'utf8'))
      expect(config.theme).toBe('dark')
      expect(config.projects[forwardKey]).toEqual({
        allowedTools: ['Bash'],
        hasTrustDialogAccepted: true,
      })
      // No backslash twin invented.
      expect(Object.keys(config.projects)).toEqual([forwardKey])
    })
  })

  it('creates the home config and entry when neither exists; already-trusted is a no-write', async () => {
    await withIsolatedHomeAndWorkspace(async (homeDir, workspacePath) => {
      await approveProjectMcpjsonServer(workspacePath, 'notion')
      const forwardKey = workspacePath.replaceAll('\\', '/')
      const config = JSON.parse(readFileSync(join(homeDir, '.claude.json'), 'utf8'))
      expect(config.projects[forwardKey].hasTrustDialogAccepted).toBe(true)

      const before = readFileSync(join(homeDir, '.claude.json'), 'utf8')
      await approveProjectMcpjsonServer(workspacePath, 'other-server')
      expect(readFileSync(join(homeDir, '.claude.json'), 'utf8')).toBe(before)
    })
  })
})
