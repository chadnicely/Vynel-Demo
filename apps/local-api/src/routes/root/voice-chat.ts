// The VOICE thread's UI doors (voice-session arc) — the spoken twin of the
// root's `/continuing` + `/transcript` reads, plus the status the Voice chat
// menu row wears:
//
//   GET /voice-chat/continuing -> the spoken thread's identity
//   GET /voice-chat/transcript -> its chain-spanning history
//   GET /voice-chat/status     -> its sessions-overview entry (status facts)
//
// Split out of `index.ts` (session-hardening D4): these are the only
// owner-scoped, deliberately NON-tool routes in a file of tool-exposed ones —
// the spoken conversation stays behind the cross-session wall, and these are
// how the Voice chat surface reads its OWN area. No `x-mcp`, ever.

import { resolver } from 'hono-openapi/zod'
import { findVoicePrimarySessionForUser } from '@vynel/session/continuity'
import { findChatSessionById } from '@vynel/chat/repositories'
import { resolveSessionChainTranscript } from '@vynel/session/runtime'
import { getVoiceChatOverviewEntry } from '@vynel/session/overview'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { enrichPrimaryTranscript } from '../../sessions/enrich-chat-session-detail.js'
import {
  ContinuingConversationResponseSchema,
  ContinuingTranscriptResponseSchema,
  VoiceChatStatusResponseSchema,
} from './schemas.js'

export const voiceChatRoutes = factory
  .createApp()
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
  // GET /voice-chat/status — the spoken thread's sessions-overview entry, so
  // the Voice chat row can wear the SAME status mark every other conversation
  // wears (session-hardening D2). It is its own door because the shared
  // `GET /sessions/overview` is also `list_sessions`: the voice entry must
  // never ride an agent-visible answer.
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/voice-chat/status',
    describeRoute({
      tags: ['root'],
      summary: "Get the voice conversation's sessions-overview entry (its status facts).",
      'x-sdk-name': 'root.getVoiceStatus',
      responses: {
        200: {
          description:
            '{ entry } — the voice conversation as one overview entry; null until the first voice turn creates it.',
          content: {
            'application/json': { schema: resolver(VoiceChatStatusResponseSchema) },
          },
        },
      },
    }),
    ...userScoped,
    (c) => c.json({ entry: getVoiceChatOverviewEntry(c.var.db, { userId: c.var.user.id }) }),
  )
