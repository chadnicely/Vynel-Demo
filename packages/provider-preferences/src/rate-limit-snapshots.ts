// The provider's SUBSCRIPTION LIMIT snapshots — what the engine reported about
// the account's rate-limit windows (the CLI's /usage numbers), captured from
// the session stream's rate-limit events on every interactive turn and read
// back by `GET /providers/:providerId/limits` (the account popup's Limits
// tab). Stored inside `defaultSettings.providerSpecific` like the discovered
// models (the opaque per-provider blob — never queried inside). Identity
// metadata only — never a credential (D14): the numbers ride the same session
// stream Vynel already consumes.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import * as providerPreferencesRepository from '@vynel/db/repositories/providers'
import type { Database } from '@vynel/db'
import type { AiAgentProviderId } from '@vynel/providers'

const RATE_LIMITS_KEY = 'rateLimits'

/** One limit window's latest reading. `windowKind` is the provider's own
 *  vocabulary ('five_hour', 'seven_day', 'seven_day_opus', …) — display
 *  mapping happens at the surface. */
export type RateLimitSnapshot = {
  windowKind: string
  status: 'allowed' | 'allowed_warning' | 'rejected'
  /** Percent of the window used (0–100). Null when the engine didn't say. */
  utilization: number | null
  /** When the window resets (ISO-8601). Null when the engine didn't say. */
  resetsAt: string | null
  /** When this reading was captured (ISO-8601) — the "as of" line. */
  capturedAt: string
}

export type RecordRateLimitSnapshotInput = {
  userId: string
  providerId: AiAgentProviderId
  snapshot: Omit<RateLimitSnapshot, 'capturedAt'>
}

/** Persist one window's latest reading, keyed by its windowKind — every event
 *  overwrites only its own window, so the seven-day reading survives a
 *  five-hour update. */
export function recordRateLimitSnapshot(db: Database, input: RecordRateLimitSnapshotInput): void {
  const snapshot: RateLimitSnapshot = { ...input.snapshot, capturedAt: new Date().toISOString() }
  withTransaction(db, (tx) => {
    const existing = providerPreferencesRepository.findProviderPreferenceForUserAndProvider(
      tx,
      input.userId,
      input.providerId,
    )
    if (existing !== null) {
      const stored = readSnapshotMap(existing.defaultSettings.providerSpecific?.[RATE_LIMITS_KEY])
      providerPreferencesRepository.updateProviderPreference(tx, existing.id, {
        defaultSettings: {
          ...existing.defaultSettings,
          providerSpecific: {
            ...existing.defaultSettings.providerSpecific,
            [RATE_LIMITS_KEY]: { ...stored, [snapshot.windowKind]: snapshot },
          },
        },
      })
      return
    }
    const now = new Date()
    providerPreferencesRepository.insertProviderPreference(tx, {
      id: randomUUID(),
      userId: input.userId,
      providerId: input.providerId,
      isDefault: false,
      defaultSettings: {
        providerSpecific: { [RATE_LIMITS_KEY]: { [snapshot.windowKind]: snapshot } },
      },
      createdAt: now,
      updatedAt: now,
    })
  })
}

/** The last reading per window — empty before the first capture (the popup
 *  shows its run-a-turn hint). Shape-checked on read: a corrupt blob degrades
 *  to empty, never to a broken popup. */
export function listRateLimitSnapshots(
  db: Database,
  userId: string,
  providerId: AiAgentProviderId,
): RateLimitSnapshot[] {
  const preference = providerPreferencesRepository.findProviderPreferenceForUserAndProvider(
    db,
    userId,
    providerId,
  )
  const stored = readSnapshotMap(preference?.defaultSettings.providerSpecific?.[RATE_LIMITS_KEY])
  return Object.values(stored)
}

function readSnapshotMap(stored: unknown): Record<string, RateLimitSnapshot> {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {}
  const snapshots: Record<string, RateLimitSnapshot> = {}
  for (const entry of Object.values(stored)) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as RateLimitSnapshot).windowKind !== 'string' ||
      typeof (entry as RateLimitSnapshot).capturedAt !== 'string'
    ) {
      continue
    }
    const snapshot = entry as RateLimitSnapshot
    snapshots[snapshot.windowKind] = {
      windowKind: snapshot.windowKind,
      status:
        snapshot.status === 'allowed_warning' || snapshot.status === 'rejected'
          ? snapshot.status
          : 'allowed',
      utilization: typeof snapshot.utilization === 'number' ? snapshot.utilization : null,
      resetsAt: typeof snapshot.resetsAt === 'string' ? snapshot.resetsAt : null,
      capturedAt: snapshot.capturedAt,
    }
  }
  return snapshots
}
