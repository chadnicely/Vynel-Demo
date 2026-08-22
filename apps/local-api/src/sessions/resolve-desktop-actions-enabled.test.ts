// The precedence rule behind Settings → Desktop control, pinned as a table:
// the user's toggle ALWAYS wins, and `VYNEL_DESKTOP_ACT_ENABLED` only seeds
// the never-touched state (a dev convenience, deprecated for users).
//
// `loadEnv()` memoises, so each row runs on a FRESH module graph — the db and
// the resolver are imported inside that graph together, never across it.

import { describe, expect, it, vi } from 'vitest'

const USER_ID = 'user-1'
const PREFERENCE_KEY = 'desktopActionsEnabled'

/** `seed: undefined` = the user has never touched the toggle. A string seed is
 *  written raw, to cover a row that is not JSON / not a boolean. */
async function resolveWith(
  envValue: string | undefined,
  seed: boolean | string | undefined,
): Promise<boolean> {
  vi.resetModules()
  const previous = process.env['VYNEL_DESKTOP_ACT_ENABLED']
  if (envValue === undefined) delete process.env['VYNEL_DESKTOP_ACT_ENABLED']
  else process.env['VYNEL_DESKTOP_ACT_ENABLED'] = envValue
  try {
    const { withTestDatabase } = await import('@vynel/testing')
    const { insertUser, upsertPreferenceForUser } = await import('@vynel/db/repositories/users')
    const { resolveDesktopActionsEnabled } = await import('./resolve-desktop-actions-enabled.js')
    return await withTestDatabase((db) => {
      const now = new Date()
      insertUser(db, {
        id: USER_ID,
        displayName: 'Dana',
        emailAddress: null,
        locale: 'en-US',
        timezone: 'UTC',
        hasCompletedOnboarding: true,
        createdAt: now,
        updatedAt: now,
      })
      if (seed !== undefined) {
        upsertPreferenceForUser(
          db,
          USER_ID,
          PREFERENCE_KEY,
          typeof seed === 'boolean' ? JSON.stringify(seed) : seed,
        )
      }
      return resolveDesktopActionsEnabled(db, USER_ID)
    })
  } finally {
    if (previous === undefined) delete process.env['VYNEL_DESKTOP_ACT_ENABLED']
    else process.env['VYNEL_DESKTOP_ACT_ENABLED'] = previous
  }
}

describe('resolveDesktopActionsEnabled', () => {
  it.each([
    { preference: true, env: '0', expected: true },
    { preference: true, env: '1', expected: true },
    // The rule that matters: an explicit OFF is not overridden by the env.
    { preference: false, env: '0', expected: false },
    { preference: false, env: '1', expected: false },
  ])(
    'preference $preference wins over VYNEL_DESKTOP_ACT_ENABLED=$env → $expected',
    async ({ preference, env, expected }) => {
      expect(await resolveWith(env, preference)).toBe(expected)
    },
  )

  it('never touched + env off → off (the fail-closed default every install ships with)', async () => {
    expect(await resolveWith('0', undefined)).toBe(false)
  })

  it('never touched + env unset → off', async () => {
    expect(await resolveWith(undefined, undefined)).toBe(false)
  })

  it('never touched + env on → on (the dev seed, the knob’s only remaining job)', async () => {
    expect(await resolveWith('1', undefined)).toBe(true)
    expect(await resolveWith('true', undefined)).toBe(true)
  })

  // The dev seed is only real if a REAL first run leaves the key untouched.
  // `getOrCreateLocalUser` seeds theme / chatStreamingEnabled / reducedMotion
  // and nothing else — if it ever seeds this key too, every install would have
  // an explicit row, the preference branch would always win, and the env knob
  // would be silently dead while every comment still promised it worked.
  it('survives a REAL first run — the seeder leaves the toggle untouched', async () => {
    vi.resetModules()
    const previous = process.env['VYNEL_DESKTOP_ACT_ENABLED']
    process.env['VYNEL_DESKTOP_ACT_ENABLED'] = '1'
    try {
      const { withTestDatabase } = await import('@vynel/testing')
      const { getOrCreateLocalUser } = await import('@vynel/core/users')
      const { resolveDesktopActionsEnabled } = await import('./resolve-desktop-actions-enabled.js')
      await withTestDatabase((db) => {
        const user = getOrCreateLocalUser(db)
        expect(resolveDesktopActionsEnabled(db, user.id)).toBe(true)
      })
    } finally {
      if (previous === undefined) delete process.env['VYNEL_DESKTOP_ACT_ENABLED']
      else process.env['VYNEL_DESKTOP_ACT_ENABLED'] = previous
    }
  })

  // A corrupt row reads as "never chosen" rather than as a silent yes — the
  // same forgiving parse `getUserPreferences` applies to every key.
  it.each([
    { label: 'not JSON at all', stored: 'yes' },
    { label: 'JSON, but not a boolean', stored: '"on"' },
    { label: 'JSON null', stored: 'null' },
  ])('a stored value that is $label falls through to the env', async ({ stored }) => {
    expect(await resolveWith('1', stored)).toBe(true)
    expect(await resolveWith('0', stored)).toBe(false)
  })
})
