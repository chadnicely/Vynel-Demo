// Emits the agent-run lifecycle outbox events (`agent.run-started` /
// `agent.run-completed`) for the future `monitor`. Each is a single outbox
// insert via the `_shared` outbox repo — no accompanying state change (no
// orchestration table in v1), so no transaction is needed. Per
// `docs/agent-base/orchestration.md` (lifecycle events through the outbox,
// no cross-domain repo writes).

import { randomUUID } from 'node:crypto'
import type { Database } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import {
  AGENT_RUN_STARTED,
  AGENT_RUN_COMPLETED,
  type AgentRunStartedPayload,
  type AgentRunCompletedPayload,
} from '../orchestration-events.js'

export async function recordAgentRunStarted(
  db: Database,
  payload: AgentRunStartedPayload,
): Promise<void> {
  insertOutboxEvent(db, {
    id: randomUUID(),
    type: AGENT_RUN_STARTED,
    payload,
    createdAt: new Date(),
    processedAt: null,
  })
}

export async function recordAgentRunCompleted(
  db: Database,
  payload: AgentRunCompletedPayload,
): Promise<void> {
  insertOutboxEvent(db, {
    id: randomUUID(),
    type: AGENT_RUN_COMPLETED,
    payload,
    createdAt: new Date(),
    processedAt: null,
  })
}
