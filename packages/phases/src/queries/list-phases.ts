// Read ops — the workspace's build plan in build order (backs the in-session
// MCP `list_phases`) and the single-phase full read (backs `get_phase` — the
// list surface carries previews only; this is where the big description is
// actually read).

import { NotFoundError } from '@vynel/errors'
import * as phasesRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type { Phase, PhaseStatus } from '../repositories/index.js'

export function listPhases(
  db: Database,
  input: { userId: string; workspaceId: string; status?: PhaseStatus },
): Phase[] {
  return phasesRepository.listPhasesForWorkspace(db, input)
}

export function getPhaseOrThrow(db: Database, input: { phaseId: string; userId: string }): Phase {
  const phase = phasesRepository.findPhaseById(db, input.phaseId)
  // Not-found and not-owned are deliberately the same 404 (no existence probe).
  if (!phase || phase.userId !== input.userId) {
    throw new NotFoundError('phase', input.phaseId)
  }
  return phase
}
