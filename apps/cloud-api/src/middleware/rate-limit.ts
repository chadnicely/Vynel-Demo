// Minimal fixed-window in-memory rate limiter for the credential routes.
// Keyed per EMAIL (not IP): the hub sits behind Chad's reverse proxy where
// client IPs need forwarded-header trust config — per-account limiting is
// the guard that matters against credential stuffing. Single-process state
// is fine for the hub's one-container deployment; revisit if it ever scales
// horizontally.

import { RateLimitedError } from '@vynel/errors'

export interface FixedWindowRateLimiter {
  /** Throws RateLimitedError when the key exceeded the window's budget. */
  consume(key: string): void
}

export function createFixedWindowRateLimiter(options: {
  readonly limit: number
  readonly windowMs: number
  readonly now?: () => number
}): FixedWindowRateLimiter {
  const now = options.now ?? Date.now
  const windows = new Map<string, { windowStart: number; count: number }>()

  return {
    consume(key) {
      const timestamp = now()
      const entry = windows.get(key)
      if (entry === undefined || timestamp - entry.windowStart >= options.windowMs) {
        // Bound the map by sweeping EXPIRED entries only — clearing wholesale
        // would let an attacker reset a target's live window by burning
        // ~10k junk keys.
        if (windows.size > 10_000) {
          for (const [staleKey, staleEntry] of windows) {
            if (timestamp - staleEntry.windowStart >= options.windowMs) windows.delete(staleKey)
          }
        }
        windows.set(key, { windowStart: timestamp, count: 1 })
        return
      }
      entry.count += 1
      if (entry.count > options.limit) {
        throw new RateLimitedError('Too many attempts — wait a few minutes and try again.')
      }
    },
  }
}
