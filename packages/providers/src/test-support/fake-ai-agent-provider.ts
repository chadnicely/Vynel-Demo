// A minimal fake `AiAgentProvider` for the status-op tests. Every method
// throws to signal misuse unless a test overrides it — the same shape as the
// route-level fakes (skills `/synchronize` precedent), so a passing test
// proves exactly which runtime read an op performed.

import type { AiAgentProvider } from '../shared/ai-agent-provider.js'

export function makeFakeAiAgentProvider(overrides: Partial<AiAgentProvider> = {}): AiAgentProvider {
  return {
    providerId: 'claude' as const,
    getAuthenticationStatus: async () => {
      throw new Error('getAuthenticationStatus not faked for this test')
    },
    discoverInstalledSkills: async () => {
      throw new Error('discoverInstalledSkills not faked for this test')
    },
    listConfiguredMcpServers: async () => [],
    startChatSession: () => {
      throw new Error('startChatSession not faked for this test')
    },
    respondToApprovalRequest: async () => {
      throw new Error('respondToApprovalRequest not faked for this test')
    },
    interruptChatSession: async () => {
      throw new Error('interruptChatSession not faked for this test')
    },
    fetchPersistedSessionTranscript: async () => {
      throw new Error('fetchPersistedSessionTranscript not faked for this test')
    },
    synchronizePersistedSessions: async () => [],
    getContextReport: async () => null,
    summarizeSession: async () => null,
    ...overrides,
  } as AiAgentProvider
}
