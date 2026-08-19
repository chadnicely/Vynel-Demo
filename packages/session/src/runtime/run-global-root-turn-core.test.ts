// Integration tests for `runGlobalRootTurnCore` — real SQLite + the fake
// provider, no live SDK. The global brain was the one continuing identity with
// NO boundary continuity (it rode to the SDK's ceiling and forgot everything);
// these pin that its turns now run the same one op every identity runs:
// measure the persisted occupancy → seed-fresh swap at pressure → the next
// turn resumes the fresh segment → the thread still shows every pre-swap row.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { findChatSessionById } from '@vynel/chat/repositories'
import type { ChatTurnEvent } from '@vynel/chat'
import type { Database } from '@vynel/db'
import type { NormalizedSessionEvent, StartChatSessionInput } from '@vynel/providers'
import {
  collectDelegationReportsForRoot,
  enqueueWorkspaceDelegation,
  failDelegationJob,
} from '@vynel/orchestration'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import {
  getOrCreatePrimarySession,
  getOrCreateContinuingSession,
  findPrimaryConversation,
  markPendingCheckpoint,
  peekPendingCheckpoint,
  SESSION_SWAPPED_EVENT_TYPE,
} from '../continuity/index.js'
import { findPrimarySessionById } from '../repositories/index.js'
import { loadSessionInstruction } from '@vynel/instructions/session-instructions'
import { FakeAiAgentProvider } from './test-support/fake-ai-agent-provider.js'
import { runGlobalRootTurnCore } from './run-global-root-turn-core.js'
import { resolvePrimaryTranscript } from './resolve-primary-transcript.js'
import type { GlobalRootTarget, SessionSink } from './session-types.js'

const GLOBAL_ROOT_CWD = '/tmp/vynel/global-root'

// A carry that clears the swap's fidelity floor.
const USABLE_CARRY =
  'GOAL: keep helping across workspaces. DONE: answered the greeting. NEXT: await the next message. FACTS: the user said hi.'

// 0.95 of Haiku's 200k window (over the 0.85 threshold) / 0.05 (under it).
const PRESSURED_USAGE = { inputTokens: 190_000, outputTokens: 10, model: 'claude-haiku-4-5' }
const RELAXED_USAGE = { inputTokens: 10_000, outputTokens: 10, model: 'claude-haiku-4-5' }

function makeUser() {
  const now = new Date()
  return {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
}

// The apps-edge resolver, minus the env-coupled cwd: get-or-create the global
// primary and hand back what it currently points at.
function resolveGlobalTarget(db: Database, userId: string): () => Promise<GlobalRootTarget> {
  return async () => {
    const primary = await getOrCreatePrimarySession(db, { userId })
    return {
      primarySessionId: primary.id,
      resumeSdkSessionId: primary.currentSdkSessionId,
      workspacePath: GLOBAL_ROOT_CWD,
    }
  }
}

class CollectingSink implements SessionSink {
  readonly events: ChatTurnEvent[] = []
  ended = false
  errors: unknown[] = []
  onEvent(event: ChatTurnEvent): void {
    this.events.push(event)
  }
  onEnd(): void {
    this.ended = true
  }
  onError(err: unknown): void {
    this.errors.push(err)
  }
}

function bareTurnInput(userId: string, userMessageText: string) {
  return {
    userId,
    userMessageText,
    mcpServers: {},
    deniedMcpToolPatterns: [],
    mutatingToolNames: [],
    askModeApprovalToolNames: [],
    mcpSystemPromptAppend: '',
  }
}

describe('runGlobalRootTurnCore — boundary continuity', () => {
  it('first turn: starts fresh, links the global primary, and stays put under the threshold', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const provider = new FakeAiAgentProvider({
        sessionIds: ['global-a', 'global-b'],
        resultText: 'Hello there.',
        usage: RELAXED_USAGE,
        summary: USABLE_CARRY,
      })
      const sink = new CollectingSink()

      await runGlobalRootTurnCore(
        { db, logger: silentLogger, resolveTarget: resolveGlobalTarget(db, user.id), provider },
        bareTurnInput(user.id, 'hi'),
        sink,
      )

      expect(sink.ended).toBe(true)
      expect(sink.errors).toEqual([])
      const primary = await getOrCreatePrimarySession(db, { userId: user.id })
      expect(primary.currentSdkSessionId).toBe('global-a')
      // Nothing swapped: no second segment, no session.swapped.
      expect(findChatSessionById(db, 'global-b')).toBeNull()
      expect(listOutboxEventsByType(db, SESSION_SWAPPED_EVENT_TYPE)).toHaveLength(0)
    })
  })

  it('a turn that leaves the brain over the threshold seed-fresh swaps BEFORE the next turn — which resumes the fresh segment; the thread spans both', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      // Three SDK starts through one fake: turn 1 (segment A, pressured), the
      // swap's priming session (segment B, no usage), then turn 2 resuming B
      // (relaxed — a fresh segment starts low). The fake records every start's
      // input so the test can assert what each resumed.
      const startInputs: StartChatSessionInput[] = []
      const provider = new FakeAiAgentProvider({
        sessionIds: ['global-a', 'global-b', 'global-b'],
        resultText: 'Noted.',
        usageReports: [PRESSURED_USAGE, undefined, RELAXED_USAGE],
        summary: USABLE_CARRY,
        startChatSessionInputs: startInputs,
      })

      const deps = {
        db,
        logger: silentLogger,
        resolveTarget: resolveGlobalTarget(db, user.id),
        provider,
      }

      // Turn 1 — fresh root A, ends at 0.95 → the boundary swap runs inside
      // the turn's lock and repoints the primary at the seeded segment B.
      const sink1 = new CollectingSink()
      await runGlobalRootTurnCore(deps, bareTurnInput(user.id, 'remember: the codename is BLUEHERON'), sink1)
      expect(sink1.ended).toBe(true)

      // The swap is VISIBLE on the sink: after the turn's own events, before
      // the stream ends — patching, then patched onto the fresh segment.
      const kinds1 = sink1.events.map((e) => e.kind)
      expect(kinds1.slice(-3)).toEqual(['session-completed', 'context-patching', 'context-patched'])
      expect(sink1.events.at(-1)).toMatchObject({ kind: 'context-patched', sessionId: 'global-a', toSessionId: 'global-b' })

      const primaryAfterTurn1 = await getOrCreatePrimarySession(db, { userId: user.id })
      expect(primaryAfterTurn1.currentSdkSessionId).toBe('global-b')
      expect(primaryAfterTurn1.supersededFromSdkSessionId).toBe('global-a')
      const fresh = findChatSessionById(db, 'global-b')
      expect(fresh?.continuedFromSessionId).toBe('global-a')
      expect(fresh?.workspaceId).toBeNull()
      expect(fresh?.scope).toBe('global')
      expect(fresh?.visibility).toBe('hidden')
      expect(listOutboxEventsByType(db, SESSION_SWAPPED_EVENT_TYPE)).toHaveLength(1)
      // The distill resumed A on the turn's own model; the priming ack was the
      // cheap model (the carry-fidelity rule).
      expect(startInputs).toHaveLength(2)
      expect(startInputs[0]?.resumeSessionId).toBeUndefined() // turn 1: fresh
      expect(startInputs[1]?.resumeSessionId).toBeUndefined() // priming: fresh seeded

      // Turn 2 — resolves the primary again and RESUMES the fresh segment B.
      const sink2 = new CollectingSink()
      await runGlobalRootTurnCore(deps, bareTurnInput(user.id, 'what was the codename?'), sink2)
      expect(sink2.ended).toBe(true)
      expect(startInputs).toHaveLength(3)
      expect(startInputs[2]?.resumeSessionId).toBe('global-b')

      // Never lose chat: the global thread, read from the current head, still
      // carries turn 1's exchange from segment A ahead of turn 2's on B.
      const transcript = resolvePrimaryTranscript(db, { userId: user.id })
      expect(transcript.session?.id).toBe('global-b')
      expect(transcript.messages.map((m) => m.body)).toEqual([
        'remember: the codename is BLUEHERON',
        'Noted.',
        'what was the codename?',
        'Noted.',
      ])
    })
  })

  it('a checkpointed turn continues AUTOMATICALLY after its swap: the continuation resumes the fresh segment, persists its anchor row, and hands the model the next step', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const primary = await getOrCreatePrimarySession(db, { userId: user.id })
      const startInputs: StartChatSessionInput[] = []
      // Three starts through one fake, ONE core call: turn 1 (A, pressured —
      // the model checkpoints mid-turn), the swap's priming (B), then the
      // automatic continuation resuming B (relaxed).
      const provider = new FakeAiAgentProvider({
        sessionIds: ['global-a', 'global-b', 'global-b'],
        resultText: 'Working.',
        usageReports: [PRESSURED_USAGE, undefined, RELAXED_USAGE],
        summary: USABLE_CARRY,
        startChatSessionInputs: startInputs,
        onStartChatSession: (_input, ordinal) => {
          // What the `checkpoint` tool does when the model calls it on turn 1.
          if (ordinal === 1) markPendingCheckpoint(primary.id, 'sum the July receipts')
        },
      })
      const sink = new CollectingSink()
      await runGlobalRootTurnCore(
        { db, logger: silentLogger, resolveTarget: resolveGlobalTarget(db, user.id), provider },
        bareTurnInput(user.id, 'reconcile the receipts'),
        sink,
      )
      expect(sink.ended).toBe(true)
      expect(sink.errors).toEqual([])

      // ONE sink, in order: turn 1 → patching → patched onto B → the
      // continuation's own row → its turn → its (relaxed) end.
      const kinds = sink.events.map((e) => e.kind)
      const patchedAt = kinds.indexOf('context-patched')
      expect(patchedAt).toBeGreaterThan(0)
      expect(kinds.slice(patchedAt, patchedAt + 3)).toEqual([
        'context-patched',
        'user-message-persisted',
        'text-chunk',
      ])
      expect(kinds.at(-1)).toBe('session-completed')
      expect(kinds.filter((k) => k === 'context-patching')).toHaveLength(1)

      // The continuation resumed the FRESH head with the instruction; the
      // persisted row is the short anchor, stamped as a relayed anchor row.
      expect(startInputs).toHaveLength(3)
      expect(startInputs[2]?.resumeSessionId).toBe('global-b')
      expect(startInputs[2]?.userMessageText).toContain('NEXT STEP: sum the July receipts')
      expect(startInputs[2]?.userMessageText).toContain('This message is from Vynel, not the user')
      const transcript = resolvePrimaryTranscript(db, { userId: user.id })
      expect(transcript.session?.id).toBe('global-b')
      const anchorRow = transcript.messages.find((m) => m.body.startsWith('Continuing after patching context'))
      expect(anchorRow).toMatchObject({
        role: 'user',
        body: 'Continuing after patching context — next: sum the July receipts',
        sourceKind: 'global-root',
        sessionId: 'global-b',
      })
      expect(transcript.messages.map((m) => m.body)).toEqual([
        'reconcile the receipts',
        'Working.',
        'Continuing after patching context — next: sum the July receipts',
        'Working.',
      ])
      // Consumed — nothing pending after the loop.
      expect(peekPendingCheckpoint(primary.id)).toBeNull()
    })
  })

  it('autoContinue: false (a delivery turn the root absorbs) arms no nudge and drops a checkpoint instead of continuing', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const primary = await getOrCreatePrimarySession(db, { userId: user.id })
      const startInputs: StartChatSessionInput[] = []
      const provider = new FakeAiAgentProvider({
        sessionIds: ['global-a', 'global-b'],
        resultText: 'Absorbed.',
        usage: RELAXED_USAGE,
        startChatSessionInputs: startInputs,
        onStartChatSession: () => markPendingCheckpoint(primary.id, 'a delivery never continues'),
      })
      const sink = new CollectingSink()
      await runGlobalRootTurnCore(
        { db, logger: silentLogger, resolveTarget: resolveGlobalTarget(db, user.id), provider },
        { ...bareTurnInput(user.id, '[Report from Nova] all done'), autoContinue: false },
        sink,
      )
      expect(sink.ended).toBe(true)
      // ONE turn, no nudge armed, the stray checkpoint gone.
      expect(startInputs).toHaveLength(1)
      expect(startInputs[0]?.onToolResultContext).toBeUndefined()
      expect(sink.events.filter((e) => e.kind === 'user-message-persisted')).toHaveLength(1)
      expect(peekPendingCheckpoint(primary.id)).toBeNull()
    })
  })

  it('a swap that cannot produce a usable carry leaves the brain on its segment (aborted, not broken)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const provider = new FakeAiAgentProvider({
        sessionIds: ['global-a', 'global-b'],
        resultText: 'ok',
        usage: PRESSURED_USAGE,
        summary: null, // the distill degenerated — no carry
      })
      const sink = new CollectingSink()

      await runGlobalRootTurnCore(
        { db, logger: silentLogger, resolveTarget: resolveGlobalTarget(db, user.id), provider },
        bareTurnInput(user.id, 'hi'),
        sink,
      )

      expect(sink.ended).toBe(true)
      expect(sink.errors).toEqual([])
      const primary = await getOrCreatePrimarySession(db, { userId: user.id })
      expect(primary.currentSdkSessionId).toBe('global-a')
      expect(findChatSessionById(db, 'global-b')).toBeNull()
      expect(findPrimarySessionById(db, primary.id)?.supersededFromSdkSessionId).toBeNull()
    })
  })
})

describe('runGlobalRootTurnCore — the voice thread (voice-session arc)', () => {
  // The apps-edge voice resolver, minus the env-coupled cwd: the spoken twin's
  // own continuing identity (scope 'voice'), same ground as the global root.
  function resolveVoiceTarget(db: Database, userId: string): () => Promise<GlobalRootTarget> {
    return async () => {
      const voiceSession = await getOrCreateContinuingSession(db, { userId, scope: 'voice' })
      return {
        primarySessionId: voiceSession.id,
        resumeSdkSessionId: voiceSession.currentSdkSessionId,
        workspacePath: GLOBAL_ROOT_CWD,
      }
    }
  }

  it("a voice turn runs on the VOICE identity: scope-'voice' hidden segment, its own link, the global primary untouched", async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const provider = new FakeAiAgentProvider({
        sessionIds: ['voice-a', 'voice-b'],
        resultText: 'Spoken.',
        usage: RELAXED_USAGE,
        summary: USABLE_CARRY,
      })
      const sink = new CollectingSink()

      await runGlobalRootTurnCore(
        { db, logger: silentLogger, resolveTarget: resolveVoiceTarget(db, user.id), provider },
        { ...bareTurnInput(user.id, 'check the weather'), voice: true },
        sink,
      )

      expect(sink.ended).toBe(true)
      expect(sink.errors).toEqual([])
      // The voice identity links to the minted segment…
      const voiceSession = await getOrCreateContinuingSession(db, {
        userId: user.id,
        scope: 'voice',
      })
      expect(voiceSession.currentSdkSessionId).toBe('voice-a')
      // …and the segment wears the voice presentation: its own scope (no
      // scope view lists it), hidden, fixed title.
      const segment = findChatSessionById(db, 'voice-a')
      expect(segment?.scope).toBe('voice')
      expect(segment?.visibility).toBe('hidden')
      expect(segment?.title).toBe('Voice conversation')
      // The GLOBAL conversation is a different area: never touched by speech.
      expect(findPrimaryConversation(db, { userId: user.id, workspaceId: null })).toBeNull()
    })
  })

  it("a second voice turn RESUMES the voice thread — one continuing chain whose segments stay scope 'voice'", async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const startChatSessionInputs: StartChatSessionInput[] = []
      const provider = new FakeAiAgentProvider({
        sessionIds: ['voice-a', 'voice-b'],
        resultText: 'Spoken.',
        usage: RELAXED_USAGE,
        summary: USABLE_CARRY,
        startChatSessionInputs,
      })

      await runGlobalRootTurnCore(
        { db, logger: silentLogger, resolveTarget: resolveVoiceTarget(db, user.id), provider },
        { ...bareTurnInput(user.id, 'first utterance'), voice: true },
        new CollectingSink(),
      )
      await runGlobalRootTurnCore(
        { db, logger: silentLogger, resolveTarget: resolveVoiceTarget(db, user.id), provider },
        { ...bareTurnInput(user.id, 'second utterance'), voice: true },
        new CollectingSink(),
      )

      // One continuing thread: the second turn RESUMED the first segment.
      expect(startChatSessionInputs).toHaveLength(2)
      expect(startChatSessionInputs[0]?.resumeSessionId).toBeUndefined()
      expect(startChatSessionInputs[1]?.resumeSessionId).toBe('voice-a')
      // The fake reports a FRESH id on the resumed start (the mid-turn
      // compaction-swap shape) — the recorded successor segment chain-links
      // and INHERITS the voice scope (the predecessor-scope rule), so the
      // spoken chain never leaks a phantom global/workspace entry.
      const successor = findChatSessionById(db, 'voice-b')
      expect(successor?.continuedFromSessionId).toBe('voice-a')
      expect(successor?.scope).toBe('voice')
      expect(successor?.visibility).toBe('hidden')
    })
  })
})

describe('runGlobalRootTurnCore — the catch-up net is consumed only once the turn is underway (A4)', () => {
  function seedUnseenReport(db: Database, userId: string): string {
    const now = new Date()
    const workspace = insertWorkspace(db, {
      id: randomUUID(),
      userId,
      name: 'Seo',
      kind: 'personal' as const,
      path: `/tmp/vynel/${randomUUID()}`,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
    })
    const jobId = enqueueWorkspaceDelegation(db, {
      userId,
      parentSessionId: 'root-sdk-1',
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      workspaceName: workspace.name,
      taskText: 'audit the pages',
    })
    failDelegationJob(db, jobId, 'the audit crashed', now)
    return jobId
  }

  it('a provider that throws in startChatSession leaves the reports COLLECTABLE for the next turn', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const jobId = seedUnseenReport(db, user.id)
      class ThrowingStartProvider extends FakeAiAgentProvider {
        override startChatSession(): never {
          throw new Error('engine unreachable')
        }
      }
      const sink = new CollectingSink()
      await runGlobalRootTurnCore(
        {
          db,
          logger: silentLogger,
          resolveTarget: resolveGlobalTarget(db, user.id),
          provider: new ThrowingStartProvider(),
        },
        bareTurnInput(user.id, 'hi'),
        sink,
      )
      expect(sink.errors).toHaveLength(1)
      // The failure notice was NOT consumed by the turn that never started.
      expect(collectDelegationReportsForRoot(db, { userId: user.id }).jobIds).toEqual([jobId])
    })
  })

  it('a provider that errors BEFORE session-started (a bounded startup) leaves them collectable too', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const jobId = seedUnseenReport(db, user.id)
      class StartupTimeoutProvider extends FakeAiAgentProvider {
        override startChatSession(): AsyncIterable<NormalizedSessionEvent> {
          async function* events(): AsyncIterable<NormalizedSessionEvent> {
            yield {
              kind: 'session-errored',
              sessionId: '',
              errorCode: 'provider_start_timeout',
              errorMessage: 'The Claude engine did not respond within 60s while starting the session.',
              isRecoverable: true,
              erroredAt: new Date(),
            }
          }
          return events()
        }
      }
      const sink = new CollectingSink()
      await runGlobalRootTurnCore(
        {
          db,
          logger: silentLogger,
          resolveTarget: resolveGlobalTarget(db, user.id),
          provider: new StartupTimeoutProvider(),
        },
        bareTurnInput(user.id, 'hi'),
        sink,
      )
      expect(collectDelegationReportsForRoot(db, { userId: user.id }).jobIds).toEqual([jobId])
    })
  })

  it('a turn that starts marks them surfaced exactly once — the block reached the SDK session', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      seedUnseenReport(db, user.id)
      const startInputs: StartChatSessionInput[] = []
      const provider = new FakeAiAgentProvider({
        sessionIds: ['global-a'],
        resultText: 'Noted the failed audit.',
        usage: RELAXED_USAGE,
        startChatSessionInputs: startInputs,
      })
      const sink = new CollectingSink()
      await runGlobalRootTurnCore(
        { db, logger: silentLogger, resolveTarget: resolveGlobalTarget(db, user.id), provider },
        bareTurnInput(user.id, 'anything new?'),
        sink,
      )
      expect(sink.errors).toEqual([])
      // The block rode the provider input, and the net is now empty.
      expect(startInputs[0]?.userMessageText).toContain('the audit crashed')
      expect(collectDelegationReportsForRoot(db, { userId: user.id }).jobIds).toEqual([])
      // The persisted row stays the clean user text.
      const transcript = resolvePrimaryTranscript(db, { userId: user.id })
      expect(transcript.messages[0]?.body).toBe('anything new?')
    })
  })
})

describe('runGlobalRootTurnCore — settings defaults (D3) + the autopilot marker (D8)', () => {
  it('a caller that resolved no mode runs the one default (auto), never the unattended gate', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const startInputs: StartChatSessionInput[] = []
      const provider = new FakeAiAgentProvider({
        sessionIds: ['global-a'],
        resultText: 'ok',
        startChatSessionInputs: startInputs,
      })
      await runGlobalRootTurnCore(
        { db, logger: silentLogger, resolveTarget: resolveGlobalTarget(db, user.id), provider },
        bareTurnInput(user.id, 'hi'),
        new CollectingSink(),
      )
      expect(startInputs[0]?.permissionMode).toBe('auto')
      expect(startInputs[0]?.userMessageText).toBe('hi')
    })
  })

  it('autoBuildout appends the per-message autopilot marker to the PROVIDER input only', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const startInputs: StartChatSessionInput[] = []
      const provider = new FakeAiAgentProvider({
        sessionIds: ['global-a'],
        resultText: 'ok',
        startChatSessionInputs: startInputs,
      })
      await runGlobalRootTurnCore(
        { db, logger: silentLogger, resolveTarget: resolveGlobalTarget(db, user.id), provider },
        { ...bareTurnInput(user.id, 'carry on'), autoBuildout: true },
        new CollectingSink(),
      )
      expect(startInputs[0]?.userMessageText).toBe(
        `carry on\n\n${loadSessionInstruction('autopilot-marker')}`,
      )
      const transcript = resolvePrimaryTranscript(db, { userId: user.id })
      expect(transcript.messages[0]?.body).toBe('carry on')
    })
  })
})
