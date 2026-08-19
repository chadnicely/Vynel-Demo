// `createDelegatedTurnCancelLever` — the per-run "end this turn now" lever the
// hard cap pulls (session-hardening A1). A delegated run holds its target's
// single-writer lock for its WHOLE life, so the only honest way to bound it is
// to END the turn, not to stop waiting on it: `routeRequest`'s cap calls
// `interrupt()`, which interrupts the SDK session the runner has learned (the
// same provider interrupt the user's Stop route uses), and the coordinator
// then awaits the turn's own settlement.
//
// The session id arrives mid-stream (`onSessionResolved`, re-fired on a
// mid-turn swap) and the provider bounds its own startup, so a cap that fires
// before any id is known simply arms the lever — the interrupt lands the
// moment the id does. Best-effort by design: a failed interrupt is logged and
// the run still ends on its own (a bounded provider start, the reaper's card
// denial, or the user's Stop).

import type { Logger } from 'pino'
import type { AiAgentProvider } from '@vynel/providers'

export interface DelegatedTurnCancelLever {
  /** Wire into the runner's `onSessionResolved` chain — follows mid-turn swaps. */
  sessionResolved: (sdkSessionId: string) => void
  /** Interrupt the running turn: now when its session is known, else as soon
   *  as it is. Never rejects. */
  interrupt: () => Promise<void>
}

export function createDelegatedTurnCancelLever(deps: {
  provider: Pick<AiAgentProvider, 'interruptChatSession'>
  logger: Logger
  jobId: string
}): DelegatedTurnCancelLever {
  let runningSdkSessionId: string | null = null
  let interruptWanted = false

  const interruptSession = async (sdkSessionId: string): Promise<void> => {
    try {
      await deps.provider.interruptChatSession(sdkSessionId)
    } catch (err) {
      deps.logger.warn(
        { err, jobId: deps.jobId, sdkSessionId },
        'delegated turn: hard-cap interrupt failed (the run still ends on its own bounds)',
      )
    }
  }

  return {
    sessionResolved: (sdkSessionId) => {
      runningSdkSessionId = sdkSessionId
      if (interruptWanted) void interruptSession(sdkSessionId)
    },
    interrupt: async () => {
      interruptWanted = true
      if (runningSdkSessionId !== null) await interruptSession(runningSdkSessionId)
    },
  }
}
