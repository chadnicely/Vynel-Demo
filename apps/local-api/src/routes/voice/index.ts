// The `voice` HTTP surface — the brain's spoken output + the call tools.
//
//   POST   /voice/speak           -> speak (rootSurface; callId retargets into a call)
//   POST   /voice/display-active  -> the app window's screen state (NOT a tool)
//   POST   /voice/display-session -> the room's live conversation, mirrored (NOT a tool)
//   POST   /voice/calls           -> start_call (rootSurface, CARDS in ask mode)
//   GET    /voice/calls           -> list_calls (rootSurface, read-only)
//   DELETE /voice/calls/:callId   -> end_call (rootSurface, auto-approved)
//
// `display-active` and `display-session` are the two doors here that carry no
// `x-mcp`: they are a WINDOW talking to the user's other windows, not a
// capability the model may reach for. Claude deciding to hide the dock — or to
// claim the room is talking — would be a control the user never asked for.
//
// `speak` lets ANY global session emit voice: the light voice-triage session, the
// global root answering a voice request, a scheduled task's morning briefing.
// It's `rootSurface`, so the generator emits it into `generatedRoutingMcpTools`
// (the global-root turn's in-process server) — never the normal workspace chat.
//
// The CALL tools are the conductor's surface (voice-in-calls Part C): start_call
// orchestrates priming -> spawned session -> daemon audio attach -> the
// deterministic disclosure line (code announces, never the model — wording is
// Chad's call before real-world use); end_call tears audio down and points the
// conductor at the session for the summary; the raw daemon `/calls` endpoints
// stay reachable via the gateway's `/voice/*` proxy (dev), while these tool
// doors live at `/api/voice/*` — the same deliberate shadow speak has.
//
// Mutating stances (D7: every non-GET declares `mutatingApproved: true` to be
// emitted at all; the CARD is a separate axis): speaking aloud runs uncarded
// (the send_to_channel precedent); JOINING a meeting is an outward-facing act
// — start_call opts into the ask-mode card via `askApproval`; end_call is a
// DELETE, which joins the ask-approval set automatically (the house stance:
// approval is for DELETE and anything destructive).
//
// Locked Hono protocol: `describeRoute` from the local openapi.js wrapper,
// `validator` from `hono-openapi/zod`, chained methods on `factory.createApp()`.

import { resolver, validator } from 'hono-openapi/zod'
import { z } from 'zod'
import { loadToolDescription } from '@vynel/instructions/tool-descriptions'
import { buildCallDisclosureLine, buildCallSessionPurpose } from '@vynel/voice'
import { createSpawnedSession } from '@vynel/session/spawned'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { loadEnv } from '../../env.js'
import { ensureGlobalRootWorkspaceDir } from '../../sessions/global-root-workspace.js'
import { TURN_SESSION_HEADER, parseTurnSessionHeader } from '../../sessions/turn-session-header.js'
import { speakThroughDaemon } from './speak-through-daemon.js'
import { reloadVoiceThroughDaemon } from './reload-through-daemon.js'
import {
  endCallThroughDaemon,
  listCallsThroughDaemon,
  speakIntoCallThroughDaemon,
  startCallThroughDaemon,
} from './calls-through-daemon.js'
import {
  DisplayActiveRequestSchema,
  DisplayActiveResponseSchema,
  DisplaySessionRequestSchema,
  DisplaySessionResponseSchema,
  EndCallResponseSchema,
  ListCallsResponseSchema,
  SpeakRequestSchema,
  SpeakResponseSchema,
  StartCallRequestSchema,
  StartCallResponseSchema,
} from './schemas.js'

// The spoken persona, matching the daemon's hardcoded address name — the
// persona rename arc threads a configurable name through both later.
const CALL_ASSISTANT_NAME = 'Vynel'

const CallIdParamSchema = z.object({ callId: z.string().min(1) })

// Mirrors `VoiceReloadResponse` (@vynel/contracts/voice/voice-reload).
const VoiceReloadResponseSchema = z.union([
  z.object({
    reloaded: z.literal(true),
    ttsModelId: z.string(),
    sttModelId: z.string(),
    speakerId: z.number().int(),
    changed: z.array(z.string()),
    missing: z.array(z.string()),
  }),
  z.object({ reloaded: z.literal(false), reason: z.string() }),
])

export const voiceApp = factory
  .createApp()
  .post(
    '/speak',
    describeRoute({
      tags: ['voice'],
      summary: "Speak text aloud through the user's voice (the voice daemon's speaker) or into a live call.",
      'x-sdk-name': 'voice.speak',
      responses: {
        200: {
          description: "{ spoken: true } — or { spoken: false, reason } if voice output isn't available.",
          content: { 'application/json': { schema: resolver(SpeakResponseSchema) } },
        },
      },
      'x-mcp': {
        exposed: true,
        name: 'speak',
        mutatingApproved: true,
        rootSurface: true,
        // Editable markdown, the session-instructions pattern — re-run
        // `pnpm api:generate` after editing speak.md so the registry copy follows.
        description: loadToolDescription('speak'),
      },
    }),
    validator('json', SpeakRequestSchema),
    ...userScoped,
    async (c) => {
      const { text, callId } = c.req.valid('json')
      // A remote engine has no speaker and its loopback voice URL would point
      // at the SERVER, not the user's machine — answer honestly without probing.
      if (c.var.remoteEngine) {
        return c.json({
          spoken: false,
          reason: 'voice output lives on the desktop; this engine runs on a remote server',
        })
      }
      if (callId !== undefined) {
        const spoken = await speakIntoCallThroughDaemon(loadEnv().VYNEL_VOICE_DAEMON_URL, callId, text)
        return c.json(spoken.ok ? { spoken: true } : { spoken: false, reason: spoken.reason })
      }
      // The producing session rides the ambient turn-session header (server-
      // stamped, never model input) — the daemon routes the line by it.
      const sessionId = parseTurnSessionHeader(c.req.header(TURN_SESSION_HEADER)) ?? null
      return c.json(await speakThroughDaemon(loadEnv().VYNEL_VOICE_DAEMON_URL, text, sessionId))
    },
  )
  // Settings → Voice saved a pick: apply it to the running daemon now. The
  // user's door (no x-mcp) — Claude does not change whose voice it speaks with.
  .post(
    '/reload',
    describeRoute({
      tags: ['voice'],
      summary: "Apply the user's saved voice pick to the running voice daemon.",
      'x-sdk-name': 'voice.reload',
      responses: {
        200: {
          description:
            '{ reloaded: true, …what is now in force, changed, missing } — or { reloaded: false, reason } when no daemon is running (the pick still applies at its next start).',
          content: { 'application/json': { schema: resolver(VoiceReloadResponseSchema) } },
        },
      },
    }),
    ...userScoped,
    async (c) => {
      if (c.var.remoteEngine) {
        return c.json({
          reloaded: false,
          reason: 'voice lives on the desktop; this engine runs on a remote server',
        })
      }
      return c.json(await reloadVoiceThroughDaemon(loadEnv().VYNEL_VOICE_DAEMON_URL))
    },
  )
  .post(
    '/display-active',
    describeRoute({
      tags: ['voice'],
      summary: "Report whether the app window's Display is on screen, for the user's other voice windows.",
      'x-sdk-name': 'voice.setDisplayActive',
      responses: {
        200: {
          description: '{ published } — false when this engine has no live channel to fan it over.',
          content: { 'application/json': { schema: resolver(DisplayActiveResponseSchema) } },
        },
      },
    }),
    validator('json', DisplayActiveRequestSchema),
    ...userScoped,
    (c) => {
      const { active } = c.req.valid('json')
      const sink = c.var.voiceControlSink
      sink?.publish(c.var.user.id, { kind: 'display-active', active })
      return c.json({ published: sink !== undefined })
    },
  )
  .post(
    '/display-session',
    describeRoute({
      tags: ['voice'],
      summary:
        "Report the voice conversation the app window's Display is holding, so the dock can mirror it.",
      'x-sdk-name': 'voice.setDisplaySession',
      responses: {
        200: {
          description: '{ published } — false when this engine has no live channel to fan it over.',
          content: { 'application/json': { schema: resolver(DisplaySessionResponseSchema) } },
        },
      },
    }),
    validator('json', DisplaySessionRequestSchema),
    ...userScoped,
    (c) => {
      const { live, phase, caption } = c.req.valid('json')
      const sink = c.var.voiceControlSink
      sink?.publish(c.var.user.id, { kind: 'display-session', live, phase, caption })
      return c.json({ published: sink !== undefined })
    },
  )
  .post(
    '/calls',
    describeRoute({
      tags: ['voice'],
      summary: 'Join a live call: spawn the call session, attach call audio, announce the presence.',
      'x-sdk-name': 'voice.startCall',
      responses: {
        200: {
          description:
            '{ started: true, callId, sessionId } — or { started: false, reason } when the daemon/cables are unavailable.',
          content: { 'application/json': { schema: resolver(StartCallResponseSchema) } },
        },
      },
      'x-mcp': {
        exposed: true,
        name: 'start_call',
        mutatingApproved: true,
        askApproval: true,
        rootSurface: true,
        description: loadToolDescription('start_call'),
      },
    }),
    validator('json', StartCallRequestSchema),
    ...userScoped,
    async (c) => {
      const { label, mode, goal, capturePid, captureProcessName } = c.req.valid('json')
      if (c.var.remoteEngine) {
        return c.json({
          started: false,
          reason: 'calls run on the desktop; this engine runs on a remote server',
        })
      }
      // The daemon rejects this pair too, but by then the spawned call session
      // below already exists — a caller bug would orphan one per attempt.
      if (capturePid !== undefined && captureProcessName !== undefined) {
        return c.json({
          started: false,
          reason: 'give capturePid or captureProcessName, not both',
        })
      }
      const created = await createSpawnedSession(c.var.db, c.var.aiProvider, {
        userId: c.var.user.id,
        name: label,
        purpose: buildCallSessionPurpose({ label, mode, assistantName: CALL_ASSISTANT_NAME, goal }),
        workspacePath: ensureGlobalRootWorkspaceDir(),
        logger: c.var.logger,
      })
      const daemonUrl = loadEnv().VYNEL_VOICE_DAEMON_URL
      const started = await startCallThroughDaemon(daemonUrl, {
        label,
        mode,
        sessionId: created.sessionId,
        ...(capturePid !== undefined ? { capturePid } : {}),
        ...(captureProcessName !== undefined ? { captureProcessName } : {}),
      })
      if (!started.ok) {
        return c.json({
          started: false,
          reason:
            `${started.reason} — the call session "${created.name}" was still created ` +
            'and remains in the Sessions panel',
        })
      }
      // Deterministic disclosure — code announces, never the model. Best-effort
      // for the RETURN (a lost announcement must not fail a joined call) but
      // never silent: this line is the consent artifact.
      const disclosure = await speakIntoCallThroughDaemon(
        daemonUrl,
        started.value.callId,
        buildCallDisclosureLine(CALL_ASSISTANT_NAME, mode),
      )
      if (!disclosure.ok) {
        c.var.logger.warn(
          { callId: started.value.callId, reason: disclosure.reason },
          'disclosure line was not spoken — call joined unannounced',
        )
      }
      return c.json({ started: true, callId: started.value.callId, sessionId: created.sessionId })
    },
  )
  .get(
    '/calls',
    describeRoute({
      tags: ['voice'],
      summary: 'List the live calls Vynel is currently on.',
      'x-sdk-name': 'voice.listCalls',
      responses: {
        200: {
          description: '{ calls } — empty when not in any call (or on a remote engine).',
          content: { 'application/json': { schema: resolver(ListCallsResponseSchema) } },
        },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_calls',
        rootSurface: true,
        description: loadToolDescription('list_calls'),
      },
    }),
    ...userScoped,
    async (c) => {
      if (c.var.remoteEngine) return c.json({ calls: [] })
      const listed = await listCallsThroughDaemon(loadEnv().VYNEL_VOICE_DAEMON_URL)
      // A daemon that isn't running has no live calls — an empty list IS the truth.
      return c.json({ calls: listed.ok ? listed.value : [] })
    },
  )
  .delete(
    '/calls/:callId',
    describeRoute({
      tags: ['voice'],
      summary: "Leave a live call — detach Vynel's ears and voice; the call session remains.",
      'x-sdk-name': 'voice.endCall',
      responses: {
        200: {
          description: '{ ended: true, sessionId } — or { ended: false, reason } when the call was already gone.',
          content: { 'application/json': { schema: resolver(EndCallResponseSchema) } },
        },
      },
      'x-mcp': {
        exposed: true,
        name: 'end_call',
        mutatingApproved: true,
        rootSurface: true,
        description: loadToolDescription('end_call'),
      },
    }),
    validator('param', CallIdParamSchema),
    ...userScoped,
    async (c) => {
      const { callId } = c.req.valid('param')
      if (c.var.remoteEngine) {
        return c.json({ ended: false, reason: 'calls run on the desktop; this engine runs on a remote server' })
      }
      const ended = await endCallThroughDaemon(loadEnv().VYNEL_VOICE_DAEMON_URL, callId)
      if (!ended.ok) return c.json({ ended: false, reason: ended.reason })
      return c.json({
        ended: true,
        ...(ended.value.sessionId !== undefined ? { sessionId: ended.value.sessionId } : {}),
      })
    },
  )
