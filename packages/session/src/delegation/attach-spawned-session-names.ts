// Enriches in-flight delegation DTOs with the SPAWNED target session's display
// name: a row carrying `targetPrimarySessionId` gains `sessionName` — so the
// processing chip can say "Research: pricing · compare the pages" instead of a
// generic "Session" (orchestration can't read the session's name; this tier
// composes the two, the attachDelegationTaskLabels precedent). Workspace-target
// rows carry `sessionName: null` — their `workspaceName` already labels them.

import type { Database } from '@vynel/db'
import { findPrimarySessionById } from '../repositories/index.js'
import { resolveSpawnedSessionDisplayName } from './resolve-spawned-session-name.js'

export function attachSpawnedSessionNames<
  TDelegation extends { targetPrimarySessionId: string | null },
>(
  db: Database,
  delegations: TDelegation[],
): (TDelegation & { sessionName: string | null; targetSessionId: string | null })[] {
  // Several queued jobs can target the same session — resolve each once. The
  // CURRENT segment id rides along (redesign 2c): a pointer click opens the
  // target's real conversation by it, no client-side primary→segment mapping.
  const resolvedByPrimaryId = new Map<string, { name: string; segmentId: string | null }>()
  return delegations.map((delegation) => {
    const targetId = delegation.targetPrimarySessionId
    if (targetId === null) return { ...delegation, sessionName: null, targetSessionId: null }
    let resolved = resolvedByPrimaryId.get(targetId)
    if (resolved === undefined) {
      const primary = findPrimarySessionById(db, targetId)
      resolved = {
        name: resolveSpawnedSessionDisplayName(db, primary),
        segmentId: primary?.currentSdkSessionId ?? null,
      }
      resolvedByPrimaryId.set(targetId, resolved)
    }
    return { ...delegation, sessionName: resolved.name, targetSessionId: resolved.segmentId }
  })
}
