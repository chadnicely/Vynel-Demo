// Response serializers for `phases` HTTP routes. Date columns emit as ISO
// strings. TWO shapes (the contracts note): the list item swaps the big-form
// `description` for a bounded preview; the single-phase response carries the
// full text. Single source of truth for both is
// `@vynel/contracts/phases/phase-http`.

import type { Phase } from '@vynel/phases'
import type { PhaseResponse, PhaseListItemResponse } from '@vynel/contracts/phases/phase-http'
import { buildDescriptionPreview } from '../_shared/description-preview.js'

export function serializePhaseForResponse(phase: Phase): PhaseResponse {
  return {
    id: phase.id,
    userId: phase.userId,
    workspaceId: phase.workspaceId,
    title: phase.title,
    description: phase.description,
    orderIndex: phase.orderIndex,
    status: phase.status,
    sessionId: phase.sessionId,
    completedAt: phase.completedAt ? phase.completedAt.toISOString() : null,
    createdAt: phase.createdAt.toISOString(),
    updatedAt: phase.updatedAt.toISOString(),
  }
}

export function serializePhaseForListResponse(phase: Phase): PhaseListItemResponse {
  const { description, ...rest } = serializePhaseForResponse(phase)
  return { ...rest, descriptionPreview: buildDescriptionPreview(description) }
}
