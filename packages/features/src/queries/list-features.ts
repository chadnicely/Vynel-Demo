// Read ops — the workspace's feature catalog (backs the in-session MCP
// `list_features`, optionally narrowed to one phase or status) and the
// single-feature full read (backs `get_feature` — the list surface carries
// previews only; this is where the big description is actually read).

import { NotFoundError } from '@vynel/errors'
import * as featuresRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type { Feature, FeatureStatus } from '../repositories/index.js'

export function listFeatures(
  db: Database,
  input: { userId: string; workspaceId: string; status?: FeatureStatus; phaseId?: string },
): Feature[] {
  return featuresRepository.listFeaturesForWorkspace(db, input)
}

export function getFeatureOrThrow(
  db: Database,
  input: { featureId: string; userId: string },
): Feature {
  const feature = featuresRepository.findFeatureById(db, input.featureId)
  // Not-found and not-owned are deliberately the same 404 (no existence probe).
  if (!feature || feature.userId !== input.userId) {
    throw new NotFoundError('feature', input.featureId)
  }
  return feature
}
