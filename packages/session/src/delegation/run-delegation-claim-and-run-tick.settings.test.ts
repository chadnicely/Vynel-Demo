// Settings on delegated turns (session-hardening A5, decisions D3/D4/D8) —
// end-to-end through the tick with the fake provider: every runner resolves
// `job ?? target row ?? DEFAULT` (a colleague run: `job ?? agent.model ?? row`),
// the resolved mode reaches the MCP composition AND the provider, and a target
// on autopilot gets the per-message marker on the PROVIDER input only — the
// persisted inbound row stays the clean task text.

import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { StartChatSessionInput } from '@vynel/providers'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertChatSession,
  listChatMessagesForSession,
  updateChatSession,
  type ChatSession,
} from '@vynel/chat/repositories'
import { buildNewChatSessionRow } from '@vynel/chat'
import { createAgentRowForTest as createAgent } from '@vynel/agents/test-support'
import { loadSessionInstruction } from '@vynel/instructions/session-instructions'
import {
  enqueueAgentRun,
  enqueueReportDelivery,
  enqueueWorkspaceDelegation,
} from '@vynel/orchestration'
import {
  getOrCreateContinuingSession,
  getOrCreatePrimarySession,
  linkPrimarySessionToSdkSession,
} from '../continuity/index.js'
import { FakeAiAgentProvider } from '../runtime/test-support/fake-ai-agent-provider.js'
import { SessionActivityFeed } from '../runtime/session-activity-feed.js'
import { runDelegationClaimAndRunTick } from './run-delegation-claim-and-run-tick.js'

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger
const AUTOPILOT_MARKER = loadSessionInstruction('autopilot-marker')

type SegmentSettings = Partial<
  Pick<ChatSession, 'sessionMode' | 'selectedModel' | 'thinkingEffort' | 'autoBuildout'>
>

function seedUserAndWorkspace(db: Database) {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'Test User',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
  const workspace = insertWorkspace(db, {
    id: randomUUID(),
    userId: user.id,
    name: 'Acme',
    managerName: 'Mark',
    kind: 'personal' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return { user, workspace }
}

/** A HEAD segment for a primary — a chat_sessions row the primary points at,
 *  carrying the settings its user chose. Returns the sdk session id. */
function linkHeadSegment(
  db: Database,
  primary: { id: string; userId: string; workspaceId: string | null },
  settings: SegmentSettings,
): string {
  const sessionId = `head-${randomUUID()}`
  insertChatSession(
    db,
    buildNewChatSessionRow({
      sessionId,
      userId: primary.userId,
      workspaceId: primary.workspaceId,
      providerId: 'claude',
      startedAt: new Date(),
    }),
  )
  updateChatSession(db, sessionId, settings)
  linkPrimarySessionToSdkSession(db, {
    primarySessionId: primary.id,
    userId: primary.userId,
    sdkSessionId: sessionId,
  })
  return sessionId
}

const attachment = {
  mcpServers: {},
  deniedMcpToolPatterns: [],
  mutatingToolNames: [],
  askModeApprovalToolNames: [],
  systemPromptAppend: '',
}

describe('settings on delegated turns — job ?? target row ?? DEFAULT', () => {
  it('a WORKSPACE task with no picks runs under the workspace conversation’s own settings, and its autopilot marker rides the provider input only', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedUserAndWorkspace(db)
      const primary = await getOrCreatePrimarySession(db, { userId: user.id, workspaceId: workspace.id })
      const headSessionId = linkHeadSegment(db, primary, {
        sessionMode: 'ask',
        selectedModel: 'claude-sonnet-4-5',
        thinkingEffort: 'high',
        autoBuildout: true,
      })
      enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: 'global-sdk-1',
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'tidy the notes',
      })
      const inputs: StartChatSessionInput[] = []
      const composeWorkspaceMcpServers = vi.fn(() => attachment)
      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({
          seededSessionId: headSessionId,
          resultText: 'ok',
          startChatSessionInputs: inputs,
        }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        composeWorkspaceMcpServers,
      })
      const turn = inputs[0]!
      expect(turn.permissionMode).toBe('ask')
      expect(turn.model).toBe('claude-sonnet-4-5')
      expect(turn.thinkingEffort).toBe('high')
      // The marker rides the PROVIDER text…
      expect(turn.userMessageText).toBe(`tidy the notes\n\n${AUTOPILOT_MARKER}`)
      // …the MCP composition sees the SAME mode the provider ran…
      expect(composeWorkspaceMcpServers).toHaveBeenCalledWith(
        expect.objectContaining({ permissionMode: 'ask' }),
      )
      // …and the persisted inbound row stays the clean task text.
      const rows = listChatMessagesForSession(db, headSessionId)
      expect(rows.find((m) => m.role === 'user')?.body).toBe('tidy the notes')
    })
  })

  it('a job’s stamped picks win over the row; a target NOT on autopilot gets no marker', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedUserAndWorkspace(db)
      const primary = await getOrCreatePrimarySession(db, { userId: user.id, workspaceId: workspace.id })
      const headSessionId = linkHeadSegment(db, primary, {
        sessionMode: 'ask',
        selectedModel: 'claude-sonnet-4-5',
        thinkingEffort: 'high',
        autoBuildout: false,
      })
      enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: 'global-sdk-1',
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'tidy the notes',
        permissionMode: 'auto',
        model: 'claude-haiku-4-5',
        thinkingEffort: 'low',
      })
      const inputs: StartChatSessionInput[] = []
      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({
          seededSessionId: headSessionId,
          resultText: 'ok',
          startChatSessionInputs: inputs,
        }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
      })
      const turn = inputs[0]!
      expect(turn.permissionMode).toBe('auto')
      expect(turn.model).toBe('claude-haiku-4-5')
      expect(turn.thinkingEffort).toBe('low')
      expect(turn.userMessageText).toBe('tidy the notes')
    })
  })

  it('a colleague run resolves job ?? agent.model ?? colleague row, and inherits the colleague row’s autopilot', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedUserAndWorkspace(db)
      await createAgent(db, {
        userId: user.id,
        workspaceId: null,
        slug: 'code-reviewer',
        name: 'Code Reviewer',
        description: 'Reviews code.',
        prompt: 'You review code carefully.',
        source: 'user',
        trustTier: 'community',
        model: 'claude-opus-4-6',
      })
      const colleague = await getOrCreateContinuingSession(db, {
        userId: user.id,
        scope: 'agent',
        workspaceId: workspace.id,
        scopeRef: 'code-reviewer',
      })
      const headSessionId = linkHeadSegment(db, colleague, {
        sessionMode: 'bypass',
        selectedModel: 'claude-sonnet-4-5',
        thinkingEffort: 'medium',
        autoBuildout: true,
      })
      enqueueAgentRun(db, {
        userId: user.id,
        parentSessionId: 'ws-primary-sdk',
        agentSlug: 'code-reviewer',
        agentName: 'Code Reviewer',
        taskText: '@code-reviewer look at the latest diff',
        workspaceId: workspace.id,
        runCwdPath: workspace.path,
        targetPrimarySessionId: colleague.id,
        requesterWorkspaceId: workspace.id,
      })
      const inputs: StartChatSessionInput[] = []
      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({
          seededSessionId: headSessionId,
          resultText: 'Reviewed.',
          startChatSessionInputs: inputs,
        }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
      })
      const turn = inputs[0]!
      // No job mode → the colleague row's; agent.model beats the row's model;
      // effort from the row; autopilot from the row.
      expect(turn.permissionMode).toBe('bypass')
      expect(turn.model).toBe('claude-opus-4-6')
      expect(turn.thinkingEffort).toBe('medium')
      expect(turn.userMessageText).toContain(AUTOPILOT_MARKER)
    })
  })

  it('a WORKSPACE report delivery runs under the REQUESTER conversation’s mode — no hardcoded unattended default', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedUserAndWorkspace(db)
      const primary = await getOrCreatePrimarySession(db, { userId: user.id, workspaceId: workspace.id })
      const headSessionId = linkHeadSegment(db, primary, { sessionMode: 'ask' })
      enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: 'child-sdk-1',
        reporterLabel: 'Research session',
        reportBody: 'Findings: three items.',
        requester: { kind: 'workspace-primary', workspaceId: workspace.id, workspacePath: workspace.path },
      })
      const inputs: StartChatSessionInput[] = []
      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({
          seededSessionId: headSessionId,
          resultText: 'Absorbed.',
          startChatSessionInputs: inputs,
        }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
      })
      expect(inputs[0]!.permissionMode).toBe('ask')
    })
  })

  it('nothing chosen anywhere → the one default: auto', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedUserAndWorkspace(db)
      enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: 'child-sdk-1',
        reporterLabel: 'Research session',
        reportBody: 'Findings: three items.',
        requester: { kind: 'workspace-primary', workspaceId: workspace.id, workspacePath: workspace.path },
      })
      const inputs: StartChatSessionInput[] = []
      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({
          seededSessionId: 'ws-root-fresh',
          resultText: 'Absorbed.',
          startChatSessionInputs: inputs,
        }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
      })
      expect(inputs[0]!.permissionMode).toBe('auto')
      expect(inputs[0]!.model).toBeUndefined()
      expect(inputs[0]!.userMessageText).not.toContain(AUTOPILOT_MARKER)
    })
  })
})
