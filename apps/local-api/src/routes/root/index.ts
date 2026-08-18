// The `root` HTTP surface (agent-base Slice 4) — the GLOBAL root's turn entry. Top-
// level + user-scoped (the global root has no workspace), so it does NOT nest under
// /workspaces/:workspaceId. The no-workspace sibling of the workspace chat turn.
//
//   GET  /continuing            -> resolve the global root conversation (landing helper)
//   GET  /transcript            -> the global root conversation history (cold-start hydration)
//   GET  /trace/:partialSessionId -> TIER 1: the condensed delegation trace
//   GET  /trace/:partialSessionId/stream -> observe a LIVE delegation's turn (SSE)
//   GET  /sessions/:sessionId   -> TIER 2: one owned session in full (trace drill-down)
//   GET  /sessions/:sessionId/transcript -> a folded chain's full history (Sessions panel)
//   GET  /delegations           -> the user's in-flight delegations (processing indicator)
//   POST /turn                  -> start a global-root turn; SSE stream (LLM-native routing)
//
// None opts into MCP: the turn is not a tool surface, and the reads are UI
// landing/liveness helpers. Locked Hono protocol: `describeRoute` from the local
// openapi.js wrapper, `validator` from `hono-openapi/zod`, chained methods on
// `factory.createApp()`.

import { resolver, validator } from 'hono-openapi/zod'
import { streamSSE } from 'hono/streaming'
import {
  findPrimaryConversation,
  findVoicePrimarySessionForUser,
} from '@vynel/session/continuity'
import {
  listInFlightDelegations,
  findDelegationJobByPartialSessionId,
  failPendingDelegationJob,
} from '@vynel/orchestration'
import { NotFoundError } from '@vynel/errors'
import { DEFAULT_PROVIDER_ID } from '@vynel/providers'
import { getChatSessionDetail, interruptChatSession } from '@vynel/chat'
import { findChatSessionById } from '@vynel/chat/repositories'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { streamGlobalRootTurn } from '../../streams/global-root-turn.js'
import {
  resolvePrimaryTranscript,
  resolveSessionChainTranscript,
} from '@vynel/session/runtime'
import { resolveDelegationTrace } from '@vynel/session/delegation'
import { traceChannelKey, attachSpawnedSessionNames } from '@vynel/session/delegation'
import {
  enrichChatSessionDetail,
  enrichPrimaryTranscript,
} from '../../sessions/enrich-chat-session-detail.js'
import {
  StartGlobalRootTurnRequestSchema,
  DelegationTraceParamSchema,
  RootSessionParamSchema,
  ContinuingConversationResponseSchema,
  ContinuingTranscriptResponseSchema,
  DelegationTraceResponseSchema,
  ChatSessionDetailResponseSchema,
  ListInFlightDelegationsResponseSchema,
  StopDelegationResponseSchema,
  InterruptGlobalTurnResponseSchema,
} from './schemas.js'

export const rootApp = factory
  .createApp()
  // ──────────────────────────────────────────────────────────────────
  // GET /continuing — resolve the global root conversation (read-only;
  // nulls until the first global-root turn creates it). Wire keys keep
  // the source names (rootSessionId) — the root→primary rename is
  // package-side only.
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/continuing',
    describeRoute({
      tags: ['root'],
      summary:
        'Resolve the global root conversation (read-only; nulls until the first global-root turn).',
      'x-sdk-name': 'root.getContinuing',
      responses: {
        200: {
          description:
            '{ rootSessionId, currentSdkSessionId, lastMessageAt } — nulls when no global root exists yet.',
          content: {
            'application/json': { schema: resolver(ContinuingConversationResponseSchema) },
          },
        },
      },
      // No x-mcp — a UI landing helper, not an agent tool surface.
    }),
    ...userScoped,
    (c) => {
      // workspaceId omitted → the global root.
      const root = findPrimaryConversation(c.var.db, { userId: c.var.user.id })
      const currentSessionId = root?.currentSdkSessionId ?? null
      const current =
        currentSessionId === null ? null : findChatSessionById(c.var.db, currentSessionId)
      return c.json({
        rootSessionId: root?.id ?? null,
        currentSdkSessionId: currentSessionId,
        lastMessageAt: current?.lastMessageAt.toISOString() ?? null,
      })
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /transcript — the global root conversation history (messages across
  // the swap-segment chain), for the continuing global thread. Serves the
  // session-detail envelope (session = the CURRENT segment, enriched like
  // `root.getSession`) so the thread renders through the same pipeline.
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/transcript',
    describeRoute({
      tags: ['root'],
      summary: 'Get the global root conversation history (messages across swap segments).',
      'x-sdk-name': 'root.getTranscript',
      responses: {
        200: {
          description:
            '{ session, messages, toolCallsByMessageId } — the current segment (null until the first turn) + the chain-spanning message history.',
          content: {
            'application/json': { schema: resolver(ContinuingTranscriptResponseSchema) },
          },
        },
      },
    }),
    ...userScoped,
    (c) =>
      c.json(
        enrichPrimaryTranscript(
          c.var.db,
          resolvePrimaryTranscript(c.var.db, { userId: c.var.user.id }),
        ),
      ),
  )
  // ──────────────────────────────────────────────────────────────────
  // The VOICE thread's UI doors (voice-session arc) — the spoken twin of the
  // two routes above. UI-only (no x-mcp): the tool surface stays behind the
  // cross-session wall; these are how the Voice chat menu reads its own area.
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/voice-chat/continuing',
    describeRoute({
      tags: ['root'],
      summary:
        'Resolve the voice conversation (read-only; nulls until the first voice turn creates it).',
      'x-sdk-name': 'root.getVoiceContinuing',
      responses: {
        200: {
          description:
            '{ rootSessionId, currentSdkSessionId, lastMessageAt } — the voice thread identity; nulls when nothing was ever spoken.',
          content: {
            'application/json': { schema: resolver(ContinuingConversationResponseSchema) },
          },
        },
      },
    }),
    ...userScoped,
    (c) => {
      const voiceSession = findVoicePrimarySessionForUser(c.var.db, c.var.user.id)
      const currentSessionId = voiceSession?.currentSdkSessionId ?? null
      const current =
        currentSessionId === null ? null : findChatSessionById(c.var.db, currentSessionId)
      return c.json({
        rootSessionId: voiceSession?.id ?? null,
        currentSdkSessionId: currentSessionId,
        lastMessageAt: current?.lastMessageAt.toISOString() ?? null,
      })
    },
  )
  .get(
    '/voice-chat/transcript',
    describeRoute({
      tags: ['root'],
      summary: 'Get the voice conversation history (messages across swap segments).',
      'x-sdk-name': 'root.getVoiceTranscript',
      responses: {
        200: {
          description:
            '{ session, messages, toolCallsByMessageId } — the spoken thread, chain-spanning like /transcript.',
          content: {
            'application/json': { schema: resolver(ContinuingTranscriptResponseSchema) },
          },
        },
      },
    }),
    ...userScoped,
    (c) => {
      const voiceSession = findVoicePrimarySessionForUser(c.var.db, c.var.user.id)
      const headSessionId = voiceSession?.currentSdkSessionId ?? null
      if (headSessionId === null) {
        return c.json({ session: null, messages: [], toolCallsByMessageId: {} })
      }
      // The same chain walk the continuing threads use, started from the voice
      // head — the wall stays down only for this owner-scoped UI door.
      return c.json(
        enrichPrimaryTranscript(
          c.var.db,
          resolveSessionChainTranscript(c.var.db, {
            userId: c.var.user.id,
            headSessionId,
          }),
        ),
      )
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /trace/:partialSessionId — TIER 1: the condensed delegation trace
  // (brain-tree Ch3). Owner-gated inside the core op (empty on miss/cross-user).
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/trace/:partialSessionId',
    describeRoute({
      tags: ['root'],
      summary: 'Get the condensed delegation trace for one request (by partialSessionId).',
      'x-sdk-name': 'root.getTrace',
      responses: {
        200: {
          description: '{ partialSessionId, entries } — the attributed chain; empty entries when unknown/not-owned.',
          content: {
            'application/json': { schema: resolver(DelegationTraceResponseSchema) },
          },
        },
      },
    }),
    validator('param', DelegationTraceParamSchema),
    ...userScoped,
    (c) => {
      const { partialSessionId } = c.req.valid('param')
      return c.json(resolveDelegationTrace(c.var.db, { userId: c.var.user.id, partialSessionId }))
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /trace/:partialSessionId/stream — observe a LIVE delegation's turn.
  // The delegation tick publishes every ChatTurnEvent to the in-process
  // broadcaster; this streams them from attach-time on (the settled rows come
  // from the plain trace GET — rows persist live, so there is no gap) and ends
  // with `turn-stream-ended` when the turn finishes. A terminal job closes
  // immediately. The Watch panel's poll remains the reconnect fallback.
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/trace/:partialSessionId/stream',
    describeRoute({
      tags: ['root'],
      summary: "Observe a live delegation's turn — streams its ChatTurnEvents via SSE.",
      'x-sdk-name': 'root.streamTrace',
      responses: {
        200: { description: 'SSE stream of the routed turn’s events; ends with turn-stream-ended.' },
        404: { description: 'Unknown trace key, or not owned.' },
      },
      // No x-mcp — SSE streaming is not a tool surface.
    }),
    validator('param', DelegationTraceParamSchema),
    ...userScoped,
    (c) => {
      const { partialSessionId } = c.req.valid('param')
      // Ownership via the job anchor (the trace read's gate) — unknown and
      // not-owned get the same 404 (no enumeration leak).
      const job = findDelegationJobByPartialSessionId(c.var.db, partialSessionId)
      if (job === null || job.userId !== c.var.user.id) {
        throw new NotFoundError('delegation-trace', partialSessionId)
      }

      const db = c.var.db
      const turnEvents = c.var.turnEvents
      return streamSSE(c, async (stream) => {
        // Terminal job → nothing live; the fetched trace is the whole story.
        const isTerminal = (): boolean => {
          const current = findDelegationJobByPartialSessionId(db, partialSessionId)
          return current === null || (current.status !== 'pending' && current.status !== 'claimed')
        }
        if (isTerminal()) {
          await stream.writeSSE({ event: 'turn-stream-ended', data: '{}' })
          return
        }

        await new Promise<void>((resolve) => {
          let settled = false
          const finish = (): void => {
            if (settled) return
            settled = true
            unsubscribe()
            clearInterval(safetyTimer)
            resolve()
          }
          const unsubscribe = turnEvents.subscribe(traceChannelKey(partialSessionId), {
            onEvent: (event) => {
              void stream.writeSSE({ event: event.kind, data: JSON.stringify(event) })
            },
            onEnd: () => {
              void stream.writeSSE({ event: 'turn-stream-ended', data: '{}' }).finally(finish)
            },
          })
          // Safety net for the attach race: if the turn ended between the liveness
          // check and the subscribe (its `end` already fired), no event will ever
          // arrive — a slow status re-check closes the stream instead of hanging it.
          const safetyTimer = setInterval(() => {
            if (isTerminal()) {
              void stream.writeSSE({ event: 'turn-stream-ended', data: '{}' }).finally(finish)
            }
          }, 5_000)
          stream.onAbort(finish)
        })
      })
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /sessions/:sessionId — TIER 2: a full session's detail (messages +
  // tool calls), OWNER-GATED (brain-tree Ch3, D1). 404 if missing or not owned
  // (no enumeration leak) — this route lacks the workspace chat ownership middleware.
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/sessions/:sessionId',
    describeRoute({
      tags: ['root'],
      summary: 'Get one owned session in full (messages + tool calls) — for the trace drill-down.',
      'x-sdk-name': 'root.getSession',
      responses: {
        200: {
          description: '{ session, messages, toolCallsByMessageId } — the full session detail.',
          content: {
            'application/json': { schema: resolver(ChatSessionDetailResponseSchema) },
          },
        },
        404: { description: 'No such session, or not owned by the caller.' },
      },
    }),
    validator('param', RootSessionParamSchema),
    ...userScoped,
    (c) => {
      const detail = getChatSessionDetail(c.var.db, c.req.valid('param').sessionId, {
        ownerUserId: c.var.user.id,
      })
      return c.json(enrichChatSessionDetail(c.var.db, detail))
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /sessions/:sessionId/transcript — a folded chain's full history,
  // opened by its newest segment (the id the sessions overview keys every
  // chain by). The Sessions panel reads THIS for a followed chain: a spawned
  // session's compaction swap repoints the chain at a fresh, empty segment —
  // the single-segment read then showed an empty conversation (the same shape
  // the continuing threads had). Owner-gated like /sessions/:sessionId.
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/sessions/:sessionId/transcript',
    describeRoute({
      tags: ['root'],
      summary: "Get one owned session's chain-spanning history (messages across swap segments).",
      'x-sdk-name': 'root.getSessionTranscript',
      responses: {
        200: {
          description:
            '{ session, messages, toolCallsByMessageId } — the head segment + messages across its whole continuation chain.',
          content: {
            'application/json': { schema: resolver(ChatSessionDetailResponseSchema) },
          },
        },
        404: { description: 'No such session, or not owned by the caller.' },
      },
    }),
    validator('param', RootSessionParamSchema),
    ...userScoped,
    (c) => {
      const transcript = resolveSessionChainTranscript(c.var.db, {
        userId: c.var.user.id,
        headSessionId: c.req.valid('param').sessionId,
      })
      return c.json(enrichChatSessionDetail(c.var.db, transcript))
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /delegations — the user's IN-FLIGHT delegations (pending + claimed),
  // for the /global "Vynel is processing…" indicator (brain-tree Ch3.5)
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/delegations',
    describeRoute({
      tags: ['root'],
      summary: 'List the user\'s in-flight delegations (pending + claimed) for the processing indicator.',
      'x-sdk-name': 'root.listDelegations',
      responses: {
        200: {
          description:
            '{ delegations: [{ partialSessionId, workspaceName, sessionName, taskLabel, status }] } — empty when idle.',
          content: {
            'application/json': { schema: resolver(ListInFlightDelegationsResponseSchema) },
          },
        },
      },
      // No x-mcp — a UI liveness indicator, not an agent tool surface.
    }),
    ...userScoped,
    // Session-target rows gain the spawned session's display name — the chip
    // labels the actual target ("Research: pricing"), not a generic 'Session'.
    (c) =>
      c.json({
        delegations: attachSpawnedSessionNames(
          c.var.db,
          listInFlightDelegations(c.var.db, { userId: c.var.user.id }),
        ),
      }),
  )
  // ──────────────────────────────────────────────────────────────────
  // POST /delegations/:partialSessionId/stop — the user's Stop on a routed
  // task. Pending → fail before claim (CAS). Claimed → flag the run on the
  // cancel bridge + interrupt its SDK session; the tick records the stop at
  // terminal time (fails the job, never pushes the partial as a report).
  // ──────────────────────────────────────────────────────────────────
  .post(
    '/delegations/:partialSessionId/stop',
    describeRoute({
      tags: ['root'],
      summary: 'Stop a delegation — fail it before claim, or cancel + interrupt its running turn.',
      'x-sdk-name': 'root.stopDelegation',
      responses: {
        200: {
          description: "{ result: 'stopped' | 'stopping' | 'already-finished' }",
          content: {
            'application/json': { schema: resolver(StopDelegationResponseSchema) },
          },
        },
        404: { description: 'Unknown delegation, or not owned.' },
      },
      // No x-mcp — a human stop control, never an agent tool.
    }),
    validator('param', DelegationTraceParamSchema),
    ...userScoped,
    async (c) => {
      const { partialSessionId } = c.req.valid('param')
      // Ownership via the job anchor — unknown and not-owned get the same 404
      // (the trace read's gate; no enumeration leak).
      const job = findDelegationJobByPartialSessionId(c.var.db, partialSessionId)
      if (job === null || job.userId !== c.var.user.id) {
        throw new NotFoundError('delegation', partialSessionId)
      }
      if (job.status !== 'pending' && job.status !== 'claimed') {
        return c.json({ result: 'already-finished' as const })
      }
      if (
        job.status === 'pending' &&
        failPendingDelegationJob(c.var.db, job.id, 'stopped by the user', new Date())
      ) {
        return c.json({ result: 'stopped' as const })
      }
      // Claimed — or a pending row the tick claimed under us (the CAS bit):
      // flag the run so the tick fails it, and interrupt the session it has
      // learned. A not-yet-started turn has no session yet — the flag alone
      // still stops it at terminal time.
      const cancel = c.var.delegationCancels.requestCancel(partialSessionId)
      if (cancel.sdkSessionId !== null) {
        await interruptChatSession(DEFAULT_PROVIDER_ID, cancel.sdkSessionId)
      }
      return c.json({ result: 'stopping' as const })
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // POST /turn — start a global-root turn; SSE stream (LLM-native routing)
  // ──────────────────────────────────────────────────────────────────
  .post(
    '/turn',
    describeRoute({
      tags: ['root'],
      summary:
        'Start a global-root turn (LLM-native routing); streams normalized session events via SSE.',
      'x-sdk-name': 'root.startTurn',
      responses: {
        200: { description: 'SSE stream of normalized session events.' },
      },
      // No x-mcp — SSE streaming is not a tool surface.
    }),
    validator('json', StartGlobalRootTurnRequestSchema),
    ...userScoped,
    async (c) => streamGlobalRootTurn(c, c.req.valid('json')),
  )
  // ──────────────────────────────────────────────────────────────────
  // POST /turn/interrupt — stop the global root's RUNNING turn server-side.
  // The composer's Stop used to only abort the client stream: the server-side
  // turn kept running detached to completion (and could keep delegating).
  // This is the missing lever — resolve the brain's current SDK session and
  // interrupt it through the provider (the workspace interrupt's sibling).
  // ──────────────────────────────────────────────────────────────────
  .post(
    '/turn/interrupt',
    describeRoute({
      tags: ['root'],
      summary: "Interrupt the global root's running turn (the workspace interrupt's sibling).",
      'x-sdk-name': 'root.interruptTurn',
      responses: {
        200: {
          description: '{ interrupted } — false when no global-root session exists yet.',
          content: {
            'application/json': { schema: resolver(InterruptGlobalTurnResponseSchema) },
          },
        },
      },
      // No x-mcp — a human stop control, never an agent tool.
    }),
    ...userScoped,
    async (c) => {
      const primary = findPrimaryConversation(c.var.db, { userId: c.var.user.id })
      const sessionId = primary?.currentSdkSessionId ?? null
      if (sessionId === null) return c.json({ interrupted: false })
      await interruptChatSession(DEFAULT_PROVIDER_ID, sessionId)
      return c.json({ interrupted: true })
    },
  )
