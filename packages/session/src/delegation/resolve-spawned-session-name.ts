// A spawned session's DISPLAY NAME, read off the LISTED identity row that
// names it — the chain's ORIGIN segment, walked back from the current head.
// A continuity swap (boundary or mid-turn) moves the head onto a hidden
// "Continued conversation" segment; the name must not follow it into
// 'Session' (it did, when this read the current segment — and boundary swaps
// on spawned sessions are routine since 2026-08-17). ONE home for the reading
// — the claim-and-run tick attributes the routed turn with it, and the
// in-flight decorator labels the processing chip with it — so the chip and
// the reply can never name the same session differently.

import type { Database } from '@vynel/db'
import type { PrimarySessionRow } from '../repositories/index.js'
import { resolveListedOriginTitle } from '../runtime/resolve-primary-transcript.js'

export function resolveSpawnedSessionDisplayName(
  db: Database,
  primary: PrimarySessionRow | null,
): string {
  const name =
    primary !== null && primary.currentSdkSessionId !== null
      ? resolveListedOriginTitle(db, { userId: primary.userId, headSessionId: primary.currentSdkSessionId })
      : null
  return name ?? 'Session'
}
