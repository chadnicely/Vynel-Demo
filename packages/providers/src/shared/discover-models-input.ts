// Input for `AiAgentProvider.discoverModels` — asks the engine which models
// THIS account can actually run, without running a turn.
//
// Why this exists as its own seam (2026-08-17): the roster used to be a
// side-effect of chatting — captured from the initialize response of a real
// turn — so the picker showed the curated static floor until the user
// happened to send a message, and a roster that changed while the app was
// open (an entitlement change, a different login) only caught up on the next
// turn. That is what made a model appear one moment and be missing the next.
// Discovery is now something the app can ASK for: at boot, and on demand.

import type { ProviderLogger } from './provider-logger.js'

export type DiscoverModelsInput = {
  /** The dispatch cwd — a real directory the engine can start in. */
  workspacePath: string

  /**
   * How long to wait for the engine's startup handshake before giving up.
   * Discovery is best-effort: a wedged or missing engine must never hold up
   * boot, so the caller always gets an answer (or null) within this bound.
   */
  timeoutMs?: number

  /** Optional structural logger (a failed discovery is logged, not thrown). */
  logger?: ProviderLogger
}
