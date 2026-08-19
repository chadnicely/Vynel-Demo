// Shared test seeds + the fire-path dep stub for the schedules core tests.
// Mirrors channels' `test-support.ts` (`stubTurnDeps` + seed helpers).
// Used by fire-schedule.test.ts and manual-fire-schedule.test.ts.

import { randomUUID } from 'node:crypto'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertSchedule } from './repositories/index.js'
import type { Database } from '@vynel/db'
import type { Schedule, NewSchedule } from './repositories/index.js'
import type { FireScheduleDeps } from './schedules-types.js'

// Re-exported for route/integration tests that seed schedules + runs directly
// (the production barrel keeps repositories internal).
export { insertSchedule, insertScheduleRun } from './repositories/index.js'
export type { NewSchedule } from './repositories/index.js'

function seedUserWorkspace(db: Database): { userId: string; workspaceId: string } {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'Dana',
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
    name: 'Bakery',
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return { userId: user.id, workspaceId: workspace.id }
}

function makeSchedule(
  userId: string,
  workspaceId: string | null,
  overrides: Partial<NewSchedule> = {},
): NewSchedule {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId,
    templateKind: 'morning-briefing',
    scheduleKind: 'recurring',
    displayName: 'Morning briefing',
    cronExpression: '0 8 * * *',
    timezone: 'UTC',
    promptTemplate: 'Good morning, {{user.displayName}}.',
    destinationKind: 'chat-only',
    channelId: null,
    catchUpOnMiss: false,
    isEnabled: true,
    approvalTimeoutMsOverride: null,
    lastFiredAt: null,
    nextScheduledFireAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function seedChatAndChannelSchedule(db: Database): Schedule {
  const { userId, workspaceId } = seedUserWorkspace(db)
  return insertSchedule(
    db,
    makeSchedule(userId, workspaceId, { destinationKind: 'chat-and-channel', channelId: 'channel-1' }),
  )
}

export function seedChatOnlySchedule(db: Database): Schedule {
  const { userId, workspaceId } = seedUserWorkspace(db)
  return insertSchedule(db, makeSchedule(userId, workspaceId, { destinationKind: 'chat-only' }))
}

// A verbatim reminder bound to a channel — fires WITHOUT an LLM turn; the
// promptTemplate is delivered as-is.
export function seedReminderSchedule(db: Database): Schedule {
  const { userId, workspaceId } = seedUserWorkspace(db)
  return insertSchedule(
    db,
    makeSchedule(userId, workspaceId, {
      templateKind: 'reminder',
      destinationKind: 'chat-and-channel',
      channelId: 'channel-1',
      promptTemplate: 'Attend your 2pm meeting.',
    }),
  )
}

function seedGlobalUser(db: Database): string {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName: 'Dana',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }).id
}

// A GLOBAL verbatim reminder (null workspaceId) bound to a channel — fires
// WITHOUT an LLM turn, so it never reaches the workspace lookup. Proves a
// global schedule fires with no workspace.
export function seedGlobalReminderSchedule(db: Database): Schedule {
  return insertSchedule(
    db,
    makeSchedule(seedGlobalUser(db), null, {
      templateKind: 'reminder',
      destinationKind: 'chat-and-channel',
      channelId: 'channel-1',
      promptTemplate: 'Attend your 2pm meeting.',
    }),
  )
}

// A GLOBAL custom schedule (null workspaceId, NOT verbatim) — fires a
// GLOBAL-ROOT turn through the injected runner (background-turns BT1).
export function seedGlobalCustomSchedule(
  db: Database,
  overrides: Partial<NewSchedule> = {},
): Schedule {
  return insertSchedule(
    db,
    makeSchedule(seedGlobalUser(db), null, {
      templateKind: 'custom',
      displayName: 'Inbox sweep',
      promptTemplate: 'Sweep my inbox, {{user.displayName}}.',
      destinationKind: 'chat-and-channel',
      channelId: 'channel-1',
      ...overrides,
    }),
  )
}

// A schedule that is due NOW (nextScheduledFireAt 30s in the past → due but
// NOT overdue, so the poll fires it as 'poll'). Override nextScheduledFireAt
// with a far-past value to exercise the overdue/catch-up branch.
export function seedDueSchedule(db: Database, overrides: Partial<NewSchedule> = {}): Schedule {
  const { userId, workspaceId } = seedUserWorkspace(db)
  return insertSchedule(
    db,
    makeSchedule(userId, workspaceId, {
      nextScheduledFireAt: new Date(Date.now() - 30_000),
      ...overrides,
    }),
  )
}

export interface StubFireDeps extends FireScheduleDeps {
  state: {
    builtMcpServer: boolean
    buildCount: number
    /** The global-root turns the stub ran (BT1) — user + rendered prompt +
     *  the fire frame (schedule-fire framing). */
    globalTurns: Array<{
      userId: string
      userMessageText: string
      frame: { marker: string; sourceLabel: string }
    }>
    /** What the fire path asked the marker renderer for — the framing
     *  assertions read the schedule name + the tz-rendered fire time here. */
    renderedMarkers: Array<{ scheduleDisplayName: string; firedAtLocal: string }>
  }
}

// The fire-path dep stub: a composeWorkspaceMcpServers that records it was
// called (the desktop-parity assertion) and counts builds (the poll's
// fire-count), a sentinel capability composition, a settings resolver that
// answers the defaults (auto / engine model / adaptive effort / no autopilot),
// and a global-root runner that records its call and answers a fixed session.
// `startChatTurn` is a no-op async generator here so the returned object
// satisfies the required FireScheduleDeps field; fire-path tests that DRIVE the
// turn override it with a local `vi.fn()` via `{ ...stubFireDeps(), startChatTurn }`
// (the verbatim + guard-path tests never call it).
export function stubFireDeps(): StubFireDeps {
  const state: StubFireDeps['state'] = {
    builtMcpServer: false,
    buildCount: 0,
    globalTurns: [],
    renderedMarkers: [],
  }
  return {
    // A no-op async generator — yields nothing (inferred AsyncGenerator<never>
    // satisfies the required AsyncIterable<ChatTurnEvent> field).
    startChatTurn: async function* () {
      // yields nothing
    },
    // Sentinel MCP composition — non-empty so tests can assert the composed
    // result reaches startChatTurn (search_knowledge stands in for a disabled
    // capability's denied tool; the deny gate now lives with the MCP composition).
    composeWorkspaceMcpServers: () => {
      state.builtMcpServer = true
      state.buildCount += 1
      return {
        mcpServers: { vynel: {} },
        deniedMcpToolPatterns: ['mcp__vynel__search_knowledge'],
        mutatingToolNames: ['mcp__vynel__create_memory_entry'],
        askModeApprovalToolNames: ['mcp__vynel__remove_knowledge_source'],
        systemPromptAppend: 'STUB_MCP_PROMPT_APPEND',
      }
    },
    composeSessionCapabilities: () => ({ systemPromptAppend: 'STUB_CAPABILITIES_APPEND' }),
    resolveWorkspaceTurnSettings: () => ({
      permissionMode: 'auto',
      model: undefined,
      thinkingEffort: undefined,
      autoBuildout: false,
    }),
    startGlobalRootTurn: async (_db, input) => {
      state.globalTurns.push({
        userId: input.userId,
        userMessageText: input.userMessageText,
        frame: input.frame,
      })
      input.onSessionResolved?.('global-sdk-1')
      return { sessionId: 'global-sdk-1', resultText: 'Inbox swept.' }
    },
    // A deterministic marker (the real words live in @vynel/instructions —
    // a sibling leaf this package's tests never load): what matters here is
    // that the fire path renders with THIS schedule's name + tz-local time
    // and forwards the result unchanged.
    renderScheduleFireMarker: (input) => {
      state.renderedMarkers.push(input)
      return `(SCHEDULE-FIRE ${input.scheduleDisplayName} @ ${input.firedAtLocal})`
    },
    state,
  }
}
