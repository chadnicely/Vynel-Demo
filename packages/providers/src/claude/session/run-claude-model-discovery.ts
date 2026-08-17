// `runClaudeModelDiscovery` — asks the engine for THIS account's model roster
// without running a turn.
//
// How it can be free: the CLI pushes its `initialize` response at startup, and
// `Query.initializationResult()` resolves from that handshake rather than
// sending a control request (the SDK's own contrast: `reinitialize()` "always
// sends a fresh request", unlike this one). So a query opened in STREAMING
// INPUT mode whose input never yields a message performs the handshake, hands
// us `models`, and is closed again — no user message, no model call, no
// session JSONL. That is why this is safe to run at boot and on demand,
// unlike the roster capture that used to ride real turns.
//
// Best-effort by contract, like every other read on this seam: a missing
// engine, a failed login, or a wedged process resolves to `null` inside the
// timeout and the caller keeps whatever roster it already had — a degraded
// answer must never blank the model picker.

import { query, type SDKUserMessage } from '../base/claude-agent-sdk.js'
import type { ProviderLogger } from '../../shared/provider-logger.js'
import type { DiscoverModelsInput } from '../../shared/discover-models-input.js'
import type { DiscoveredProviderModel } from '../../shared/start-chat-session-input.js'
import { buildClaudeSdkOptions } from '../base/build-claude-sdk-options.js'
import { mapClaudeModelInfo } from '../base/map-claude-model-info.js'

/** Long enough for a cold CLI start on a slow machine, short enough that boot
 *  never waits on a wedged one. */
const DEFAULT_DISCOVERY_TIMEOUT_MS = 20_000

export async function runClaudeModelDiscovery(
  input: DiscoverModelsInput,
): Promise<DiscoveredProviderModel[] | null> {
  const logger: ProviderLogger | undefined = input.logger
  const options = buildClaudeSdkOptions({
    // Toolless and unattended — the handshake is all we want, and `bypass`
    // keeps the dispatch clear of interactive permission machinery (the
    // distill-turn precedent; there are no tools here to permit).
    permissionMode: 'bypass',
    workspacePath: input.workspacePath,
    allowedToolNames: [],
    deniedToolNames: [],
  })
  options.maxTurns = 1
  options.tools = []
  options.persistSession = false
  const abortController = new AbortController()
  options.abortController = abortController

  // The input that never speaks: streaming-input mode keeps the session open
  // for the handshake, and this generator yields nothing, so the engine is
  // never asked to answer anything. It unblocks on abort so the finally below
  // leaves nothing suspended.
  async function* silentInput(): AsyncGenerator<SDKUserMessage> {
    await new Promise<void>((resolve) => {
      if (abortController.signal.aborted) {
        resolve()
        return
      }
      abortController.signal.addEventListener('abort', () => resolve(), { once: true })
    })
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const queryInstance = query({ prompt: silentInput(), options })
    const timeoutMs = input.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS
    const initialization = await Promise.race([
      queryInstance.initializationResult(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs)
      }),
    ])
    if (initialization === null) {
      logger?.warn({ timeoutMs }, 'model discovery timed out — keeping the known roster')
      return null
    }
    const models = mapClaudeModelInfo(initialization.models)
    // An engine that answered with nothing usable is a degraded answer, not a
    // roster: say so rather than handing back an empty picker.
    return models.length > 0 ? models : null
  } catch (error) {
    logger?.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'model discovery failed — keeping the known roster',
    )
    return null
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    // Idempotent: ends the handshake-only session and releases the generator.
    abortController.abort()
  }
}
