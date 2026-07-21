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
): (TDelegation & { sessionName: string | null })[] {
  // Several queued jobs can target the same session — resolve each name once.
  const nameByPrimaryId = new Map<string, string>()
  return delegations.map((delegation) => {
    const targetId = delegation.targetPrimarySessionId
    if (targetId === null) return { ...delegation, sessionName: null }
    let name = nameByPrimaryId.get(targetId)
    if (name === undefined) {
      name = resolveSpawnedSessionDisplayName(db, findPrimarySessionById(db, targetId))
      nameByPrimaryId.set(targetId, name)
    }
    return { ...delegation, sessionName: name }
  })
}
