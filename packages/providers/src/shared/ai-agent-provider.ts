// The `AiAgentProvider` abstract class — the contract every concrete AI agent
// runtime implements. Phase 1 ships only `ClaudeAiAgentProvider`; the abstract
// class is real from day one so Codex/Gemini/Cursor are a sibling folder, not
// a refactor. See `docs/blueprints/providers/blueprint.md §7`.

import type { AiAgentProviderId } from './ai-agent-provider-id.js'
import type { AuthenticationStatus } from './authentication-status.js'
import type { InstalledSkill, DiscoverSkillsInput } from './installed-skill.js'
import type { McpServerConfig, ListMcpServersInput } from './mcp-server-config.js'
import type {
  StartChatSessionInput,
  DiscoveredProviderModel,
} from './start-chat-session-input.js'
import type { DiscoverModelsInput } from './discover-models-input.js'
import type {
  WorkspacePlan,
  WorkspacePlanInput,
  RivalSiteStudy,
  RivalSiteStudyInput,
} from './workspace-plan.js'
import type { GetContextReportInput } from './get-context-report-input.js'
import type { SummarizeSessionInput } from './summarize-session-input.js'
import type { SummarizeReportInput } from './summarize-report-input.js'
import type { NormalizedSessionEvent } from './normalized-session-event.js'
import type { ApprovalDecision } from './approval-decision.js'
import type { ChatSessionTranscript, FetchTranscriptInput } from './chat-session-transcript.js'
import type { PersistedSessionRecord } from './persisted-session-record.js'

export abstract class AiAgentProvider {
  abstract readonly providerId: AiAgentProviderId

  /**
   * Returns whether the underlying runtime is installed on the user's machine
   * and whether the user is authenticated with it. Never throws for normal
   * "not installed" or "not authenticated" states — those are data, not
   * exceptions.
   */
  abstract getAuthenticationStatus(): Promise<AuthenticationStatus>

  /**
   * Discovers skills installed at the given scopes for this provider. Scopes
   * correspond to provider-native skill locations (user-global, workspace-local).
   */
  abstract discoverInstalledSkills(input: DiscoverSkillsInput): Promise<InstalledSkill[]>

  /**
   * Lists the MCP servers configured for this provider at the given scopes.
   * Read-only — installing MCP servers is the `marketplace` domain's job.
   */
  abstract listConfiguredMcpServers(input: ListMcpServersInput): Promise<McpServerConfig[]>

  /**
   * Starts a chat session. Returns an async iterable of normalized events that
   * terminates when the session completes, errors, or is interrupted. The
   * implementation registers the session with its active-session registry so
   * it can be interrupted from outside.
   */
  abstract startChatSession(input: StartChatSessionInput): AsyncIterable<NormalizedSessionEvent>

  /**
   * Responds to an approval request the runtime is awaiting — called when the
   * user has clicked approve / deny on an approval card. Throws
   * `NotFoundError('approval_request', requestId)` if the request id is
   * unknown (e.g. the session timed out).
   */
  abstract respondToApprovalRequest(requestId: string, decision: ApprovalDecision): Promise<void>

  /**
   * Interrupts an active chat session. The session's event stream terminates
   * cleanly with a final `session-interrupted` event. No-op if the session is
   * not active.
   */
  abstract interruptChatSession(sessionId: string): Promise<void>

  /**
   * Fetches a previously-persisted session's transcript from the runtime's own
   * storage. Used for chat history when the session is not active.
   */
  abstract fetchPersistedSessionTranscript(
    input: FetchTranscriptInput,
  ): Promise<ChatSessionTranscript>

  /**
   * Scans the runtime's session-artifact storage and returns metadata for
   * sessions created or modified since the cutoff. Used by the `chat` domain
   * to populate its sessions list on startup and after a workspace change.
   */
  abstract synchronizePersistedSessions(since?: Date): Promise<PersistedSessionRecord[]>

  /**
   * Returns the runtime's context-window report for a session — the breakdown
   * the `/context` command renders (system prompt, tools, MCP tools, memory
   * files, skills, messages, free space) as raw markdown — or `null` if this
   * provider doesn't expose one. A best-effort read; never throws. Default:
   * not supported (concrete providers override when they have a `/context`-like
   * command), so adding a provider doesn't force a stub.
   */
  getContextReport(_input: GetContextReportInput): Promise<string | null> {
    return Promise.resolve(null)
  }

  /**
   * Distills a session's conversation into a concise hand-off summary — the
   * CARRY for the session-continuity seed-fresh swap (seeded into the fresh
   * session's system prompt so it continues the work with a freed context
   * window). Returns `null` if this provider can't summarize. A best-effort
   * read; never throws. Default: not supported (concrete providers override
   * when they can summarize), so adding a provider doesn't force a stub —
   * the same shape as `getContextReport`.
   */
  summarizeSession(_input: SummarizeSessionInput): Promise<string | null> {
    return Promise.resolve(null)
  }

  /**
   * Distills a workspace manager's full delegation report into the short
   * reply shown to the user — the global chat's summary row, or a
   * channel-formatted message when the task came from a channel (the full
   * report stays on the delegation trace). Returns `null` if this provider
   * can't distill — the caller falls open to the full report. A best-effort
   * call; never throws. Default: not supported, same shape as
   * `summarizeSession`.
   */
  summarizeReport(_input: SummarizeReportInput): Promise<string | null> {
    return Promise.resolve(null)
  }

  /**
   * Asks the engine which models THIS account can actually run — the model
   * picker's roster, without running a turn (the same list the engine reports
   * at session startup, which is account-scoped: what a subscription serves
   * today is not a constant). Returns `null` when this provider can't be
   * asked, or when the engine didn't answer in time — callers keep the roster
   * they already had. A best-effort read; never throws. Default: not
   * supported, the `summarizeSession` shape.
   */
  discoverModels(_input: DiscoverModelsInput): Promise<DiscoveredProviderModel[] | null> {
    return Promise.resolve(null)
  }

  /**
   * The new-workspace wizard's "Is there one like it already?" — what a named site
   * does, what to leave out, and what would make the user's version better,
   * from the provider's own knowledge (no live read; the UI labels it so).
   * Returns `null` if this provider can't study; the screen reports it
   * plainly. Best-effort; never throws. Default: not supported, the
   * `summarizeReport` shape.
   */
  studyRivalSite(_input: RivalSiteStudyInput): Promise<RivalSiteStudy | null> {
    return Promise.resolve(null)
  }

  /**
   * Distills the wizard's answers into the plan the user rates — one-liner,
   * build list, MVP nutshell, goals, and build sessions. Returns `null` if
   * this provider can't synthesize; the wizard falls back to its own
   * mechanical derivation. Best-effort; never throws. Default: not
   * supported, the `summarizeReport` shape.
   */
  synthesizeWorkspacePlan(_input: WorkspacePlanInput): Promise<WorkspacePlan | null> {
    return Promise.resolve(null)
  }
}
