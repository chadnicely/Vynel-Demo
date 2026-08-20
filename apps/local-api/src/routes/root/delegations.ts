// The delegation-observability doors of the `root` surface — how a user
// watches, and stops, work the assistant handed down:
//
//   GET  /trace/:partialSessionId        -> TIER 1: the condensed trace
//   GET  /trace/:partialSessionId/stream -> observe a LIVE delegation (SSE)
//   GET  /delegations                    -> the in-flight delegations
//   POST /delegations/:id/stop           -> the user's Stop on a routed task
//
// Split out of `index.ts` (session-hardening D4) — the file was 503 lines and
// held four unrelated clusters. None opts into MCP: a trace is a UI read and a
// Stop is a human control, never an agent tool.

import { resolver, validator } from 'hono-openapi/zod'
import { streamSSE } from 'hono/streaming'
import {
  listInFlightDelegations,
  findDelegationJobByPartialSessionId,
  failPendingDelegationJob,
} from '@vynel/orchestration'
import { NotFoundError } from '@vynel/errors'
import { DEFAULT_PROVIDER_ID } from '@vynel/providers'
import { interruptChatSession } from '@vynel/chat'
import {
  resolveDelegationTrace,
  traceChannelKey,
  attachSpawnedSessionNames,
} from '@vynel/session/delegation'
import { dropContinuationJobCheckpoint } from '@vynel/session/continuity'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import {
  DelegationTraceParamSchema,
  DelegationTraceResponseSchema,
  ListInFlightDelegationsResponseSchema,
  StopDelegationResponseSchema,
} from './schemas.js'

export const delegationRoutes = factory
  .createApp()
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
        // A follow-up job holds the identity's checkpoint slot until its own
        // claim (audit r2 R2-H(d)) — a Stop is a settle by another route, so
        // the slot is given up here rather than waiting for the lease sweep:
        // this user is watching the thread right now.
        dropContinuationJobCheckpoint(c.var.db, job.id, {
          reason: 'turn-stopped',
          logger: c.var.logger,
        })
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
