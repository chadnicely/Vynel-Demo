// Push a mode change into the turn ALREADY RUNNING.
//
// Chad, 2026-08-25: switching from Auto to Ask has to bite immediately, even
// while the agent is mid-run. Persisting the row alone only reaches the NEXT
// turn — you watch the old mode keep acting and conclude the switch does
// nothing.
//
// Reported, never thrown: a session that is not running right now is the
// normal case (the row is already saved and the next turn carries it), so a
// false answer is information, not a failure. A runtime that refuses the
// switch does throw — the caller decides how loud to be.

import { resolveAiAgentProvider } from '@vynel/providers'
import type { AiAgentProviderId, ClaudePermissionMode } from '@vynel/providers'

export async function applyLiveSessionMode(
  providerId: AiAgentProviderId,
  sessionId: string,
  mode: ClaudePermissionMode,
): Promise<boolean> {
  const provider = resolveAiAgentProvider(providerId)
  return provider.setSessionPermissionMode(sessionId, mode)
}
