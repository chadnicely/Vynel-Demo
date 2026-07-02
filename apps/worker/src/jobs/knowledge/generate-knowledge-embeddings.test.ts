// Smoke test for the worker delegator. Confirms the (db, logger) →
// coreOp wiring boots against a real (test) database and runs without
// throwing on an empty workspace (no chunks needing embedding ⇒ no
// model call; the lazy-load singleton in @vynel/embeddings stays
// cold). Behavioral coverage of the per-chunk tx + vec0 upsert
// + FTS5 sync lives at the core layer
// (`@vynel/knowledge`'s `generate-knowledge-embeddings.test.ts`).

import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { generateKnowledgeEmbeddings } from './generate-knowledge-embeddings.js'

const silentLogger = pino({ level: 'silent' })

describe('worker job: generate-knowledge-embeddings', () => {
  it('runs without throwing on an empty database', async () => {
    await withTestDatabase(async (db) => {
      await expect(generateKnowledgeEmbeddings(db, silentLogger)).resolves.toBeUndefined()
    })
  })
})
