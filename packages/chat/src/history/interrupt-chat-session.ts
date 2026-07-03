// Core op — interrupt an active chat session. The SDK's interrupt is fast
// (milliseconds) and the SSE turn stream emits its `session-interrupted`
// event shortly after (per D13 — synchronous interrupt). No-op if the
// session is not active (provider implementation handles).
//
// No outbox event — interrupts are session-state-only; downstream consumers
// don't need a separate signal beyond the SSE event.
//
// Spec: `docs/blueprints/chat/blueprint.md §5.5`.

import { resolveAiAgentProvider } from '@vynel/providers'
import type { AiAgentProviderId } from '@vynel/providers'

export async function interruptChatSession(
  providerId: AiAgentProviderId,
  sessionId: string,
): Promise<void> {
  // Provider methods are genuinely async (talk to the SDK runtime); they stay
  // async. Resolved per-op (D23) — registry caches the singleton internally.
  const provider = resolveAiAgentProvider(providerId)
  await provider.interruptChatSession(sessionId)
}
