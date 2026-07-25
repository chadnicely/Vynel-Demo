// Unit tests for `runSeededSwapSession` — the seed-fresh priming-turn runner.
// Uses a fake provider (no live SDK). Proves: the carry is embedded in the
// FIRST user message (so it survives the next turn's resume), a fresh session
// id is captured + returned, and a missing id is a hard error.

import { describe, expect, it } from 'vitest'
import type { StartChatSessionInput } from '@vynel/providers'
import { FakeAiAgentProvider } from './test-support/fake-ai-agent-provider.js'
import { runSeededSwapSession } from './run-seeded-swap-session.js'

describe('runSeededSwapSession', () => {
  it('mints a fresh seeded session and returns its id', async () => {
    const provider = new FakeAiAgentProvider({ seededSessionId: 'sdk-fresh-42' })

    const id = await runSeededSwapSession(provider, {
      workspacePath: '/tmp/ws',
      carry: 'GOAL: ship. FACTS: codename BLUEHERON.',
    })

    expect(id).toBe('sdk-fresh-42')
  })

  it('embeds the carry in the first user message (survives the next resume), starting fresh', async () => {
    const startChatSessionInputs: StartChatSessionInput[] = []
    const provider = new FakeAiAgentProvider({
      seededSessionId: 'sdk-fresh',
      startChatSessionInputs,
    })

    await runSeededSwapSession(provider, {
      workspacePath: '/tmp/ws',
      carry: 'FACTS: codename BLUEHERON.',
      model: 'claude-haiku-4-5',
    })

    expect(startChatSessionInputs).toHaveLength(1)
    const seedInput = startChatSessionInputs[0]!
    // Fresh session — no resume.
    expect(seedInput.resumeSessionId).toBeUndefined()
    // The carry rides in the conversation, not systemPrompt.append (which is
    // recomposed per-turn and would not survive resume).
    expect(seedInput.userMessageText).toContain('codename BLUEHERON')
    expect(seedInput.model).toBe('claude-haiku-4-5')
  })

  // `createSpawnedSession` runs this inside the `create_session` MCP tool, so an
  // unbounded drain parks the calling agent with no card and no error. The bound
  // must both FAIL and interrupt — leaving a live turn nobody reads is the other
  // half of the bug.
  it('interrupts and throws when the priming turn never terminates', async () => {
    const provider = new FakeAiAgentProvider()
    provider.startChatSession = () =>
      (async function* () {
        yield { kind: 'session-started' as const, sessionId: 'sdk-stalled' }
        // Never terminates — a wedged runtime, not a slow answer.
        await new Promise<never>(() => {})
      })() as ReturnType<typeof provider.startChatSession>

    await expect(
      runSeededSwapSession(provider, { workspacePath: '/tmp/ws', carry: 'x', timeoutMs: 20 }),
    ).rejects.toThrow(/did not finish within 20ms/)
    expect(provider.interruptedSessionIds).toStrictEqual(['sdk-stalled'])
  })

  it('throws when the runtime assigns no session id', async () => {
    // A provider whose stream yields no session-started event.
    const provider = new FakeAiAgentProvider()
    // Override startChatSession to yield nothing.
    provider.startChatSession = () =>
      (async function* () {
        // no events
      })()

    await expect(
      runSeededSwapSession(provider, { workspacePath: '/tmp/ws', carry: 'x' }),
    ).rejects.toThrow(/did not assign a session id/)
  })
})
