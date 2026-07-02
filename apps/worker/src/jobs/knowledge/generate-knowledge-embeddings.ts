// Worker job — thin (db, logger) delegator to the core op per
// foundation.md §2 row 1 + the locked
// `worker-thin-delegator-composable-scheduler` precedent (chat).
// The loop + per-chunk tx + sqlite-vec writes live in
// `@vynel/knowledge` (`generate-knowledge-embeddings.ts` — the async
// core op; model call OUTSIDE the sync tx per D18).
//
// Scheduled `*/1 * * * *` via the composable `WorkerJob[]` bootstrap
// in `apps/worker/src/index.ts` per D9 + D10 (cron-only; the
// signal-on-write extension is a shared foundation-hardening
// backlog item).
//
// First consumer of the real `@vynel/embeddings` MiniLM-L6-v2
// implementation knowledge ships (replacing memory's throwing stub
// per D23 — lazy first-use cached singleton; whichever job's tick
// hits first triggers the model load).
//
// Spec: `docs/blueprints/knowledge/blueprint.md §13` + decisions D9
// + D19 + D23.

import type { Database } from '@vynel/db'
import {
  generateKnowledgeEmbeddings as generateKnowledgeEmbeddingsCore,
  type StructuralLogger,
} from '@vynel/core/knowledge'

export async function generateKnowledgeEmbeddings(
  db: Database,
  logger: StructuralLogger,
): Promise<void> {
  await generateKnowledgeEmbeddingsCore(db, {}, { logger })
}
