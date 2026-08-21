// The FEED-PRODUCER CENSUS, api side — the server half of the web's
// `rail-identity-census.test.ts` (audit R2-K: "no test pins any producer's
// `begin` payload"). Two guards, both about the same failure:
//
//   1. The ROSTER. Every production `activityFeed.begin(` caller is listed
//      below. A new producer fails until it is added WITH its frames.
//   2. The IDENTITY INVARIANT. A frame carrying the workspace scope and no
//      `primarySessionId` IS, by the readers' one matcher (`matchTurnToIdentity`,
//      web), the ROOM'S OWN turn — a workspace chat binds its live thread to it.
//      Only producers that genuinely run on the room's continuing conversation
//      may emit that shape, and only in a frame a view can bind to: a frame that
//      opens and ends in the same breath (`begin(...).end()`) carries no thread.
//
// The frames run through the REAL feed, so what is pinned is what subscribers
// actually receive after the feed's null-defaulting — not a hand-copied guess.

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SessionTurnActivity } from '@vynel/contracts/chat/session-activity'
import { SessionActivityFeed, type BeginTurnActivityInput } from './session-activity-feed.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const SOURCE_ROOTS = ['apps', 'packages'] as const
const SKIPPED_DIRS = new Set([
  'node_modules',
  'dist',
  'generated',
  'test-support',
  'target',
  'payload',
])
// A call on the feed — the handle name is the same in every producer. Spans
// lines (one producer breaks before `.begin`); comment lines are dropped first.
const BEGIN_CALL = /activityFeed\s*\.\s*begin\(/

/** The producers today — 9 files. Bump deliberately, with frames below. */
const KNOWN_PRODUCERS = [
  'apps/local-api/src/sessions/run-global-root-turn.ts',
  'apps/local-api/src/sessions/run-workspace-channel-turn.ts',
  'apps/local-api/src/sessions/start-fired-workspace-turn.ts',
  'apps/local-api/src/streams/chat-turn.ts',
  'apps/local-api/src/streams/global-root-turn.ts',
  'apps/local-api/src/streams/session-turn.ts',
  'packages/session/src/delegation/run-agent-run-job.ts',
  'packages/session/src/delegation/run-report-delivery-tick.ts',
  'packages/session/src/delegation/run-task-job.ts',
]

/** Producers whose OPEN frames legitimately read as the room's own thread —
 *  each runs ON the room's continuing conversation, so binding the room's chat
 *  to it is correct. Nothing else may emit that shape while a view can bind. */
const ROOMS_OWN_THREAD_PRODUCERS = [
  // The user's own turn in the room.
  'apps/local-api/src/streams/chat-turn.ts',
  // A delegated task/note on the workspace ROOT resumes the room's primary.
  'packages/session/src/delegation/run-task-job.ts',
  // The workspace notify turn runs on the requester room's conversation.
  'packages/session/src/delegation/run-report-delivery-tick.ts',
]

function* productionSourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) yield* productionSourceFiles(full)
      continue
    }
    if (
      !entry.name.endsWith('.ts') ||
      entry.name.endsWith('.test.ts') ||
      entry.name.endsWith('.d.ts')
    ) {
      continue
    }
    yield full
  }
}

function beginsOnTheFeed(file: string): boolean {
  const code = readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart()
      return !trimmed.startsWith('//') && !trimmed.startsWith('*')
    })
    .join('\n')
  return BEGIN_CALL.test(code)
}

function producerCensus(): string[] {
  const producers: string[] = []
  for (const root of SOURCE_ROOTS) {
    for (const file of productionSourceFiles(path.join(repoRoot, root))) {
      if (beginsOnTheFeed(file)) {
        producers.push(path.relative(repoRoot, file).split(path.sep).join('/'))
      }
    }
  }
  return producers.sort()
}

type ProducerFrame = {
  /** Which `begin` this is — named after the producer's own comment. */
  label: string
  input: Omit<BeginTurnActivityInput, 'userId'>
  /** True for a `begin(...).end()` pair — no live thread to bind to. */
  transient?: boolean
}

const FRAMES_BY_PRODUCER: Record<string, ProducerFrame[]> = {
  'apps/local-api/src/streams/global-root-turn.ts': [
    {
      label: "the user's own global turn",
      input: { scopeKind: 'global', origin: 'web', primarySessionId: 'global-primary-1' },
    },
    {
      label: 'the spoken thread (overlay / panel leg)',
      input: { scopeKind: 'voice', origin: 'voice', primarySessionId: 'voice-primary-1' },
    },
  ],
  'apps/local-api/src/sessions/run-global-root-turn.ts': [
    {
      label: 'a channel background root turn',
      input: { scopeKind: 'global', origin: 'telegram', primarySessionId: 'global-primary-1' },
    },
    {
      label: 'a report-delivery notify turn on the root (speaks as the child)',
      input: {
        scopeKind: 'global',
        origin: 'delegation',
        primarySessionId: 'global-primary-1',
        jobId: 'job-1',
        personaName: 'Noah - Invoices',
      },
    },
    {
      label: 'a global schedule fire (through the global runner)',
      input: { scopeKind: 'global', origin: 'schedule', primarySessionId: 'global-primary-1' },
    },
  ],
  'apps/local-api/src/streams/chat-turn.ts': [
    {
      label: "a room's own web turn (fresh — no session yet)",
      input: { scopeKind: 'workspace', workspaceId: 'ws-1', origin: 'web' },
    },
    {
      label: "a room's own web turn (resumed)",
      input: {
        scopeKind: 'workspace',
        workspaceId: 'ws-1',
        sessionId: 'room-segment-1',
        origin: 'web',
      },
    },
  ],
  'apps/local-api/src/streams/session-turn.ts': [
    {
      label: 'a direct send into a spawned session (global-grounded)',
      input: {
        scopeKind: 'global',
        sessionId: 'spawned-segment-1',
        origin: 'web',
        primarySessionId: 'spawned-1',
      },
    },
    {
      label: 'a direct send to an agent colleague (under its grounding room)',
      input: {
        scopeKind: 'workspace',
        workspaceId: 'ws-1',
        sessionId: 'agent-segment-1',
        origin: 'web',
        primarySessionId: 'agent-1',
      },
    },
  ],
  'apps/local-api/src/sessions/run-workspace-channel-turn.ts': [
    {
      // A channel BOUND to a workspace answers on that room's continuing
      // conversation (2026-08-21) — so the frame names that identity, and the
      // app's rail opens the live thread the reply lands on. Deliberately NOT
      // in ROOMS_OWN_THREAD_PRODUCERS: it always stamps the primary, so it
      // never emits the unstamped shape that binding rule guards.
      label: 'a workspace channel turn on the continuing conversation',
      input: {
        scopeKind: 'workspace',
        workspaceId: 'ws-1',
        sessionId: 'room-segment-1',
        origin: 'telegram',
        primarySessionId: 'room-primary-1',
      },
    },
    {
      label: 'a workspace channel turn, first-ever (segment resolves mid-turn)',
      input: {
        scopeKind: 'workspace',
        workspaceId: 'ws-1',
        origin: 'telegram',
        primarySessionId: 'room-primary-1',
      },
    },
  ],
  'apps/local-api/src/sessions/start-fired-workspace-turn.ts': [
    {
      // Schedule-on-primary: a workspace fire runs ON the room's continuing
      // conversation and its frame NAMES that identity (verified for R2-K).
      label: 'a workspace schedule fire on the continuing conversation',
      input: {
        scopeKind: 'workspace',
        workspaceId: 'ws-1',
        sessionId: 'room-segment-1',
        origin: 'schedule',
        primarySessionId: 'room-primary-1',
      },
    },
    {
      label: 'a workspace schedule fire, first-ever (segment resolves mid-turn)',
      input: {
        scopeKind: 'workspace',
        workspaceId: 'ws-1',
        origin: 'schedule',
        primarySessionId: 'room-primary-1',
      },
    },
  ],
  'packages/session/src/delegation/run-task-job.ts': [
    {
      label: 'a delegated task on a workspace root (resumes the room itself)',
      input: {
        scopeKind: 'workspace',
        workspaceId: 'ws-1',
        origin: 'delegation',
        jobId: 'job-2',
        taskLabel: 'Set up the login page',
        personaName: 'Invoices',
      },
    },
    {
      label: 'a delegated task on a spawned session (global-grounded)',
      input: {
        scopeKind: 'global',
        origin: 'delegation',
        jobId: 'job-3',
        primarySessionId: 'spawned-1',
        taskLabel: 'Reconcile July',
      },
    },
  ],
  'packages/session/src/delegation/run-agent-run-job.ts': [
    {
      // R2-K: the run announces AFTER its resolution phase, so the colleague
      // identity is always on the frame — an unstamped (legacy / failed-resolve)
      // row can no longer read as the grounding room's own thread.
      label: 'a colleague run under its grounding room',
      input: {
        scopeKind: 'workspace',
        workspaceId: 'ws-1',
        origin: 'delegation',
        jobId: 'job-4',
        primarySessionId: 'agent-1',
        taskLabel: 'Review the PR',
        personaName: 'Noah',
      },
    },
    {
      label: 'a colleague run grounded globally',
      input: {
        scopeKind: 'global',
        origin: 'delegation',
        jobId: 'job-5',
        primarySessionId: 'agent-1',
        taskLabel: 'Review the PR',
      },
    },
    {
      // The resolution phase failed (deleted agent / corrupt row): there IS no
      // colleague to name, so the grounding's problem signal fires as a frame
      // that opens and ends in the same breath — nothing can bind to it.
      label: 'a colleague run whose resolution failed (problem signal, begin+end)',
      input: {
        scopeKind: 'workspace',
        workspaceId: 'ws-1',
        origin: 'delegation',
        jobId: 'job-6',
        taskLabel: 'Review the PR',
        personaName: 'Noah',
      },
      transient: true,
    },
  ],
  'packages/session/src/delegation/run-report-delivery-tick.ts': [
    {
      label: 'a direct delivery onto the root (begin + end, no notify turn)',
      input: { scopeKind: 'global', origin: 'delegation', jobId: 'job-7', personaName: 'Noah' },
      transient: true,
    },
    {
      label: 'a workspace notify turn (runs on the requester room)',
      input: {
        scopeKind: 'workspace',
        workspaceId: 'ws-requester',
        origin: 'delegation',
        jobId: 'job-8',
        personaName: 'Noah - Invoices',
      },
    },
  ],
}

/** What subscribers actually receive for a producer's input. */
function publish(input: Omit<BeginTurnActivityInput, 'userId'>): SessionTurnActivity {
  const feed = new SessionActivityFeed()
  let published: SessionTurnActivity | null = null
  const unsubscribe = feed.subscribe('user-1', (event) => {
    if (event.kind === 'turn-started') {
      const { kind: _kind, ...turn } = event
      published = turn
    }
  })
  feed.begin({ userId: 'user-1', ...input }).end()
  unsubscribe()
  if (published === null) throw new Error('the feed published no turn-started frame')
  return published
}

function readsAsARoomsOwnThread(frame: ProducerFrame): boolean {
  if (frame.transient === true) return false
  const published = publish(frame.input)
  return published.scopeKind === 'workspace' && published.primarySessionId === null
}

describe('session-activity feed producer census', () => {
  it('the roster is the known one (bump deliberately, WITH the new producer frames below)', () => {
    expect(producerCensus()).toEqual(KNOWN_PRODUCERS)
  })

  it('every producer on the roster has its frames in the table', () => {
    expect(Object.keys(FRAMES_BY_PRODUCER).sort()).toEqual(KNOWN_PRODUCERS)
  })

  describe('each frame carries the identity fields its producer sends', () => {
    for (const [producer, frames] of Object.entries(FRAMES_BY_PRODUCER)) {
      for (const frame of frames) {
        it(`${path.basename(producer)} — ${frame.label}`, () => {
          const published = publish(frame.input)
          expect({
            scopeKind: published.scopeKind,
            workspaceId: published.workspaceId,
            primarySessionId: published.primarySessionId,
          }).toEqual({
            scopeKind: frame.input.scopeKind,
            workspaceId: frame.input.workspaceId ?? null,
            primarySessionId: frame.input.primarySessionId ?? null,
          })
        })
      }
    }
  })

  it('only a room OWN thread announces as workspace scope with no primary identity', () => {
    const impersonators = Object.entries(FRAMES_BY_PRODUCER)
      .filter(([, frames]) => frames.some(readsAsARoomsOwnThread))
      .map(([producer]) => producer)
      .sort()
    expect(impersonators).toEqual([...ROOMS_OWN_THREAD_PRODUCERS].sort())
  })
})
