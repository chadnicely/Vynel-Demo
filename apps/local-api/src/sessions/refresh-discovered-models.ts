// `refreshDiscoveredModels` — ask the engine for this account's model roster
// and persist what it says. The ONE home for deliberate discovery, with two
// callers: the boot warm (so the picker is the account's real list from the
// first paint, not the curated floor) and the picker's own refresh route.
//
// Best-effort end to end: `discoverModels` resolves to null on a missing
// engine, a failed login, or a timeout, and a null answer CHANGES NOTHING —
// the stored roster stands. That asymmetry is the point: discovery may only
// ever improve what the picker knows.

import { recordDiscoveredModels } from '@vynel/provider-preferences'
import { DEFAULT_PROVIDER_ID, type AiAgentProvider } from '@vynel/providers'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'

export type RefreshDiscoveredModelsInput = {
  userId: string
  /** The engine's dispatch cwd — the global root's hidden user-data dir. */
  workspacePath: string
  timeoutMs?: number
}

/** True when the engine answered and the roster was persisted. */
export async function refreshDiscoveredModels(
  db: Database,
  provider: AiAgentProvider,
  input: RefreshDiscoveredModelsInput,
  deps: { logger: Logger },
): Promise<boolean> {
  const models = await provider.discoverModels({
    workspacePath: input.workspacePath,
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    logger: deps.logger,
  })
  if (models === null || models.length === 0) return false
  try {
    recordDiscoveredModels(db, {
      userId: input.userId,
      providerId: DEFAULT_PROVIDER_ID,
      models,
    })
    return true
  } catch (err) {
    deps.logger.warn({ err }, 'failed to persist the refreshed model roster')
    return false
  }
}
