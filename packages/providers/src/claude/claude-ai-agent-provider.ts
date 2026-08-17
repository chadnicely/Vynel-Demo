// `ClaudeAiAgentProvider` — the Phase 1 concrete provider, built on
// `@anthropic-ai/claude-agent-sdk`. Thin: every method delegates to an
// `./internal/` helper. The class file never imports the SDK directly
// (`coding.md §1.1`) — the SDK lives only inside `./internal/`. The
// active-session + pending-approval registries are private fields, shared
// across every session this provider runs.
// See `docs/blueprints/providers/blueprint.md §11`.

import { NotFoundError } from '@vynel/errors'
import { ActiveSessionRegistry } from '../shared/active-session-registry.js'
import { AiAgentProvider } from '../shared/ai-agent-provider.js'
import { PendingApprovalRegistry } from '../shared/pending-approval-registry.js'
import type { AiAgentProviderId } from '../shared/ai-agent-provider-id.js'
import type { ApprovalDecision } from '../shared/approval-decision.js'
import type { AuthenticationStatus } from '../shared/authentication-status.js'
import type {
  ChatSessionTranscript,
  FetchTranscriptInput,
} from '../shared/chat-session-transcript.js'
import type { DiscoverSkillsInput, InstalledSkill } from '../shared/installed-skill.js'
import type { ListMcpServersInput, McpServerConfig } from '../shared/mcp-server-config.js'
import type { NormalizedSessionEvent } from '../shared/normalized-session-event.js'
import type { PersistedSessionRecord } from '../shared/persisted-session-record.js'
import type {
  StartChatSessionInput,
  DiscoveredProviderModel,
} from '../shared/start-chat-session-input.js'
import type { DiscoverModelsInput } from '../shared/discover-models-input.js'
import type { GetContextReportInput } from '../shared/get-context-report-input.js'
import type { SummarizeSessionInput } from '../shared/summarize-session-input.js'
import type { SummarizeReportInput } from '../shared/summarize-report-input.js'
import { discoverClaudeInstalledSkills } from './installation/discover-claude-installed-skills.js'
import { fetchClaudePersistedSessionTranscript } from './history/fetch-claude-persisted-session-transcript.js'
import { listClaudeConfiguredMcpServers } from './installation/list-claude-configured-mcp-servers.js'
import { readClaudeAuthenticationStatus } from './installation/read-claude-authentication-status.js'
import { runClaudeChatSession } from './session/run-claude-chat-session.js'
import { runClaudeContextReport } from './session/run-claude-context-report.js'
import { runClaudeSessionSummary } from './session/run-claude-session-summary.js'
import { runClaudeReportSummary } from './session/run-claude-report-summary.js'
import { runClaudeModelDiscovery } from './session/run-claude-model-discovery.js'
import { synchronizeClaudePersistedSessions } from './history/synchronize-claude-persisted-sessions.js'

export class ClaudeAiAgentProvider extends AiAgentProvider {
  readonly providerId: AiAgentProviderId = 'claude'

  private readonly activeSessionRegistry = new ActiveSessionRegistry()
  private readonly pendingApprovalRegistry = new PendingApprovalRegistry()

  async getAuthenticationStatus(): Promise<AuthenticationStatus> {
    return readClaudeAuthenticationStatus()
  }

  async discoverInstalledSkills(input: DiscoverSkillsInput): Promise<InstalledSkill[]> {
    return discoverClaudeInstalledSkills(input)
  }

  async listConfiguredMcpServers(input: ListMcpServersInput): Promise<McpServerConfig[]> {
    return listClaudeConfiguredMcpServers(input)
  }

  startChatSession(input: StartChatSessionInput): AsyncIterable<NormalizedSessionEvent> {
    return runClaudeChatSession({
      input,
      activeSessionRegistry: this.activeSessionRegistry,
      pendingApprovalRegistry: this.pendingApprovalRegistry,
    })
  }

  async respondToApprovalRequest(requestId: string, decision: ApprovalDecision): Promise<void> {
    const wasResolved = this.pendingApprovalRegistry.resolve(requestId, decision)
    if (!wasResolved) {
      throw new NotFoundError('approval_request', requestId)
    }
  }

  async interruptChatSession(sessionId: string): Promise<void> {
    this.pendingApprovalRegistry.cancelAllForSession(sessionId)
    await this.activeSessionRegistry.interrupt(sessionId)
  }

  async fetchPersistedSessionTranscript(
    input: FetchTranscriptInput,
  ): Promise<ChatSessionTranscript> {
    return fetchClaudePersistedSessionTranscript(input)
  }

  async synchronizePersistedSessions(since?: Date): Promise<PersistedSessionRecord[]> {
    return synchronizeClaudePersistedSessions(since)
  }

  override async getContextReport(input: GetContextReportInput): Promise<string | null> {
    return runClaudeContextReport(input)
  }

  override async summarizeSession(input: SummarizeSessionInput): Promise<string | null> {
    return runClaudeSessionSummary(input)
  }

  override async summarizeReport(input: SummarizeReportInput): Promise<string | null> {
    return runClaudeReportSummary(input)
  }

  override async discoverModels(
    input: DiscoverModelsInput,
  ): Promise<DiscoveredProviderModel[] | null> {
    return runClaudeModelDiscovery(input)
  }
}
