// Response serializers for `features` HTTP routes. Date columns emit as ISO
// strings. TWO shapes (the contracts note): the list item swaps the big-form
// `description` for a bounded preview; the single-feature response carries
// the full text. Single source of truth for both is
// `@vynel/contracts/features/feature-http`.

import type { Feature } from '@vynel/features'
import type {
  FeatureResponse,
  FeatureListItemResponse,
} from '@vynel/contracts/features/feature-http'
import { buildDescriptionPreview } from '../_shared/description-preview.js'

export function serializeFeatureForResponse(feature: Feature): FeatureResponse {
  return {
    id: feature.id,
    userId: feature.userId,
    workspaceId: feature.workspaceId,
    title: feature.title,
    description: feature.description,
    phaseId: feature.phaseId,
    status: feature.status,
    sessionId: feature.sessionId,
    completedAt: feature.completedAt ? feature.completedAt.toISOString() : null,
    createdAt: feature.createdAt.toISOString(),
    updatedAt: feature.updatedAt.toISOString(),
  }
}

export function serializeFeatureForListResponse(feature: Feature): FeatureListItemResponse {
  const { description, ...rest } = serializeFeatureForResponse(feature)
  return { ...rest, descriptionPreview: buildDescriptionPreview(description) }
}
