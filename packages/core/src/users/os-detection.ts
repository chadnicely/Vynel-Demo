// OS detection helpers used by `getOrCreateLocalUser` on first boot to
// seed sensible defaults. Best-effort — fall back to safe constants on
// failure. Per `docs/blueprints/users/blueprint.md §8` + decision D8
// ("OS detection for defaults — best-effort, not authoritative").
//
// Co-located inside the users domain because the only consumer is
// `getOrCreateLocalUser`. Promotes to `_shared/` if a second domain ever
// needs OS detection.

import os from 'node:os'

export function detectOsUsername(): string | null {
  try {
    const userInfo = os.userInfo()
    return userInfo.username || null
  } catch {
    return null
  }
}

export function detectOsLocale(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    return 'en-US'
  }
}

export function detectOsTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'UTC'
  }
}
