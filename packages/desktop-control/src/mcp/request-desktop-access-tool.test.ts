// The consent tool's contract: grants only for a RESOLVED open app (never a
// raw query), ambiguity fails safe, and the grant lands under the normalized
// key. Real SQLite via `withTestDatabase`; the window list is injected.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import type { Database } from '@vynel/db'
import {
  makeRequestDesktopAccessTool,
  resolveRequestedApp,
  listGrantableApps,
} from './request-desktop-access-tool.js'
import { normalizeDesktopAppKey } from '../access/desktop-access-tiers.js'
import { findDesktopAppGrant } from '../repositories/desktop-app-grants.js'

type BuiltTool = {
  name: string
  annotations?: { destructiveHint?: boolean }
  handler: (args: Record<string, unknown>) => Promise<{
    isError?: boolean
    content: Array<{ type: string; text?: string }>
  }>
}

function makeUserId(db: Database): string {
  const now = new Date()
  const id = randomUUID()
  insertUser(db, {
    id,
    displayName: 'Test User',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
  return id
}

describe('resolveRequestedApp', () => {
  const apps = [
    { name: 'Discord', pid: 1 },
    { name: 'Visual Studio Code', pid: 2 },
    { name: 'Notepad', pid: 3 },
  ]

  it('resolves ONLY an exact normalized-key match (.exe/case differences allowed)', () => {
    expect(resolveRequestedApp(apps, 'discord')).toEqual({ kind: 'resolved', appName: 'Discord' })
    expect(resolveRequestedApp(apps, 'DISCORD.exe')).toEqual({ kind: 'resolved', appName: 'Discord' })
  })

  it('turns a unique FUZZY match into a suggestion, never a grant (consent fidelity)', () => {
    expect(resolveRequestedApp(apps, 'disc')).toEqual({ kind: 'suggestion', appName: 'Discord' })
  })

  it('returns none when nothing matches', () => {
    expect(resolveRequestedApp(apps, 'slack')).toEqual({ kind: 'none' })
  })

  it('fails safe on a query matching more than one distinct app', () => {
    const resolved = resolveRequestedApp(apps, 'o')
    expect(resolved.kind).toBe('ambiguous')
  })

  it('treats windows of the SAME app (same normalized key) as one candidate', () => {
    const multiWindow = [
      { name: 'Discord', pid: 1 },
      { name: 'discord.exe', pid: 4 },
    ]
    expect(resolveRequestedApp(multiWindow, 'discord')).toEqual({
      kind: 'resolved',
      appName: 'Discord',
    })
  })
})

describe('makeRequestDesktopAccessTool', () => {
  it('is named request_desktop_access and marked destructive (it expands access)', () => {
    const built = makeRequestDesktopAccessTool({} as Database, 'u') as BuiltTool
    expect(built.name).toBe('request_desktop_access')
    expect(built.annotations?.destructiveHint).toBe(true)
  })

  it('grants the resolved app under its normalized key', async () => {
    await withTestDatabase(async (db) => {
      const userId = makeUserId(db)
      const built = makeRequestDesktopAccessTool(db, userId, {
        listApps: async () => [{ name: 'Discord.exe', pid: 7 }],
      }) as BuiltTool
      const result = await built.handler({ app: 'discord', tier: 'click', reason: 'read messages' })
      expect(result.isError).not.toBe(true)
      expect(findDesktopAppGrant(db, userId, 'discord')?.tier).toBe('click')
    })
  })

  it('refuses to grant when the app is not open (identity cannot be resolved)', async () => {
    await withTestDatabase(async (db) => {
      const userId = makeUserId(db)
      const built = makeRequestDesktopAccessTool(db, userId, {
        listApps: async () => [],
      }) as BuiltTool
      const result = await built.handler({ app: 'discord', tier: 'read', reason: 'x' })
      expect(result.isError).toBe(true)
      expect(findDesktopAppGrant(db, userId, 'discord')).toBeNull()
    })
  })

  it('refuses to grant on an ambiguous query (no guessing which app the user approved)', async () => {
    await withTestDatabase(async (db) => {
      const userId = makeUserId(db)
      const built = makeRequestDesktopAccessTool(db, userId, {
        listApps: async () => [
          { name: 'Notepad', pid: 1 },
          { name: 'Notion', pid: 2 },
        ],
      }) as BuiltTool
      const result = await built.handler({ app: 'not', tier: 'read', reason: 'x' })
      expect(result.isError).toBe(true)
      expect(findDesktopAppGrant(db, userId, 'notepad')).toBeNull()
      expect(findDesktopAppGrant(db, userId, 'notion')).toBeNull()
    })
  })

  it('refuses a fuzzy-only match and suggests the exact name (the card must name what is granted)', async () => {
    await withTestDatabase(async (db) => {
      const userId = makeUserId(db)
      const built = makeRequestDesktopAccessTool(db, userId, {
        listApps: async () => [{ name: 'Discord', pid: 1 }],
      }) as BuiltTool
      const result = await built.handler({ app: 'disc', tier: 'read', reason: 'x' })
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toContain('"Discord"')
      expect(findDesktopAppGrant(db, userId, 'discord')).toBeNull()
    })
  })

  it('rejects an invalid tier without touching the db', async () => {
    const built = makeRequestDesktopAccessTool({} as Database, 'u', {
      listApps: async () => [{ name: 'Discord', pid: 1 }],
    }) as BuiltTool
    const result = await built.handler({ app: 'discord', tier: 'admin', reason: 'x' })
    expect(result.isError).toBe(true)
  })
})

describe('listGrantableApps — canonical identity', () => {
  it('maps an xa11y WINDOW TITLE through its pid to the real app name', async () => {
    // The live bug: granting from the accessibility door stored
    // "Vynel - Google Chrome", which stopped matching on the next tab switch
    // and never covered the screenshot door's "Google Chrome".
    const apps = await listGrantableApps({
      windowAppNames: () => [],
      accessibilityApps: async () => [{ name: 'Vynel - Google Chrome', pid: 77 }],
      appNameByPid: (pid) => (pid === 77 ? 'Google Chrome' : null),
    })
    expect(apps.map((a) => a.name)).toContain('Google Chrome')
    expect(apps.map((a) => a.name)).not.toContain('Vynel - Google Chrome')
  })

  it('dedupes the two sources onto ONE entry per real app', async () => {
    const apps = await listGrantableApps({
      windowAppNames: () => ['Google Chrome'],
      accessibilityApps: async () => [{ name: 'Vynel - Google Chrome', pid: 77 }],
      appNameByPid: (pid) => (pid === 77 ? 'Google Chrome' : null),
    })
    expect(apps.filter((a) => normalizeDesktopAppKey(a.name) === 'google chrome')).toHaveLength(1)
  })
})
