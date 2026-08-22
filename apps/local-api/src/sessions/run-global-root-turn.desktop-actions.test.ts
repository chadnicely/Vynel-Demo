// The CHANNEL/SCHEDULE runner's Settings → Desktop control seam
// (`run-global-root-turn.ts`: `enableDesktopActions:
// resolveDesktopActionsEnabled(deps.db, input.userId)`).
//
// It lives in its own file because `run-global-root-turn.test.ts` drives a stub
// `{}` database and therefore has to mock the resolver away. This seam is the
// opposite bargain: the resolver is REAL, the database is real, and the only
// thing observed is the acting value the desktop descriptor is handed. Without
// it, regressing that call to a literal `true` would leave every suite green
// while a Telegram or schedule turn silently gained the desktop.
//
// Both legs seed the preference row explicitly. A "no row" leg would fall
// through to `VYNEL_DESKTOP_ACT_ENABLED` and read the ambient environment —
// the resolver's own fallthrough is covered by
// `resolve-desktop-actions-enabled.test.ts`, which controls that env.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Logger } from 'pino'
import type { Database } from '@vynel/db'
import { withTestDatabase } from '@vynel/testing'
import { insertUser, upsertPreferenceForUser } from '@vynel/db/repositories/users'
import type * as SessionRuntime from '@vynel/session/runtime'
import type * as Orchestration from '@vynel/orchestration'
import type * as DesktopControl from '@vynel/desktop-control'
import type { SessionActivityFeed, SessionSink } from '@vynel/session/runtime'

const { coreMock, resolveTargetMock, chatSessionRowMock, desktopBuildContexts } = vi.hoisted(
  () => ({
    coreMock: vi.fn(),
    resolveTargetMock: vi.fn(),
    chatSessionRowMock: vi.fn(),
    // Every acting value the runner hands the desktop descriptor, in turn order.
    desktopBuildContexts: [] as Array<{ enableDesktopActions: boolean | undefined }>,
  }),
)

// The heavy core is mocked so the DRAIN SINK can be driven directly; the pure
// helpers stay real (the shape `run-global-root-turn.blocked-tool.test.ts` uses).
vi.mock('@vynel/session/runtime', async () => {
  const actual = await vi.importActual<typeof SessionRuntime>('@vynel/session/runtime')
  return { ...actual, runGlobalRootTurnCore: coreMock }
})
// Stub descriptors: a null `build` keeps the composed MCP set empty and the SDK
// out of this test. The desktop one below is deliberately NOT stubbed.
vi.mock('@vynel/mcp', () => ({
  vynelRoutingDescriptor: { serverName: 'vynel', build: () => null },
}))
vi.mock('@vynel/instructions', () => ({
  notebookFeatureDescriptor: { serverName: 'vynel-notebook', build: () => null },
}))
vi.mock('@vynel/session/mcp', () => ({
  buildSessionFeatureDescriptor: () => ({
    serverName: 'vynel-session',
    build: () => null,
    mutatingToolNames: [],
  }),
}))
vi.mock('@vynel/orchestration', async () => {
  const actual = await vi.importActual<typeof Orchestration>('@vynel/orchestration')
  return { ...actual, composeSessionAgents: async () => ({}) }
})
vi.mock('@vynel/capabilities', () => ({
  defaultEnabledCapabilityIds: () => new Set<string>(),
  resolveEffectiveToolPolicies: () => new Map(),
  applyToolPolicyDefaultsToCatalog: (catalog: unknown) => catalog,
}))
// The REAL desktop descriptor, with the acting value recorded. A pass-through:
// no `desktopReader` is wired, so the real `build` still returns null and the
// composed toolset is unchanged — only the seam value is observed.
vi.mock('@vynel/desktop-control', async (importOriginal) => {
  const actual = await importOriginal<typeof DesktopControl>()
  return {
    ...actual,
    desktopFeatureDescriptor: {
      ...actual.desktopFeatureDescriptor,
      build: (context: Parameters<typeof actual.desktopFeatureDescriptor.build>[0]) => {
        desktopBuildContexts.push({ enableDesktopActions: context.enableDesktopActions })
        return actual.desktopFeatureDescriptor.build(context)
      },
    },
  }
})
vi.mock('./resolve-global-root-conversation.js', () => ({
  resolveGlobalRootConversationTarget: resolveTargetMock,
}))
vi.mock('@vynel/chat/repositories', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  findChatSessionById: chatSessionRowMock,
}))

import { runGlobalRootTurn } from './run-global-root-turn.js'

type SinkEvent = Parameters<SessionSink['onEvent']>[0]

function fakeActivityFeed(): SessionActivityFeed {
  const handle = {
    turnId: 'turn-1',
    sessionResolved: vi.fn(),
    publishTurnStep: vi.fn(),
    end: vi.fn(),
  }
  return { begin: vi.fn(() => handle) } as unknown as SessionActivityFeed
}

function fakeDeps(db: Database) {
  return {
    db,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger,
    appRequest: vi.fn(),
    activityFeed: fakeActivityFeed(),
  }
}

beforeEach(() => {
  desktopBuildContexts.length = 0
  coreMock.mockReset()
  coreMock.mockImplementation(async (_deps: unknown, _input: unknown, sink: SessionSink) => {
    await sink.onEvent({
      kind: 'user-message-persisted',
      message: { sessionId: 'sess-1' },
    } as SinkEvent)
    await sink.onEvent({ kind: 'text-chunk', messageId: 'm1', textDelta: 'ok' })
    await sink.onEnd?.()
  })
  resolveTargetMock.mockReset()
  resolveTargetMock.mockResolvedValue({
    primarySessionId: 'root-primary-1',
    resumeSdkSessionId: null,
    workspacePath: '/tmp/global-root',
  })
  chatSessionRowMock.mockReset()
  chatSessionRowMock.mockReturnValue(null)
})

function seedUser(db: Database) {
  const now = new Date()
  return insertUser(db, {
    id: 'user-desktop-seam',
    displayName: 'Dana',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: true,
    createdAt: now,
    updatedAt: now,
  })
}

describe('runGlobalRootTurn — Settings → Desktop control', () => {
  it('hands the desktop descriptor the resolved preference, and the NEXT turn sees a flip', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const deps = fakeDeps(db)

      upsertPreferenceForUser(db, user.id, 'desktopActionsEnabled', JSON.stringify(false))
      await runGlobalRootTurn(deps, {
        userId: user.id,
        userMessageText: 'before the flip',
        originChannel: 'telegram',
      })
      expect(desktopBuildContexts).toHaveLength(1)
      expect(desktopBuildContexts[0]!.enableDesktopActions).toBe(false)

      // No restart, no new runner — the very next turn re-resolves.
      upsertPreferenceForUser(db, user.id, 'desktopActionsEnabled', JSON.stringify(true))
      await runGlobalRootTurn(deps, {
        userId: user.id,
        userMessageText: 'after the flip',
        originChannel: 'telegram',
      })
      expect(desktopBuildContexts).toHaveLength(2)
      expect(desktopBuildContexts[1]!.enableDesktopActions).toBe(true)
    })
  })
})
