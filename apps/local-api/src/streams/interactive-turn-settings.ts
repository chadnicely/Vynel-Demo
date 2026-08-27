// How an INTERACTIVE stream resolves its turn settings — ONE home for the three
// user-facing streams (global/voice `streamGlobalRootTurn`, workspace chat
// `streamChatTurn`, spawned-session DM `streamSpawnedSessionTurn`), so the
// rules below hold identically wherever a turn enters (session-hardening arc,
// 2026-08-19):
//
//   KEYBOARD turn — `input ?? the session's persisted row ?? DEFAULT` for
//   mode / model / effort / auto-buildout (the per-session settings rule; the
//   default is `DEFAULT_SESSION_MODE` everywhere, decision D3). The resolved
//   mode is what the turn runs AND what its children inherit — the stream
//   stamps it on every routing request unconditionally.
//
//   VOICE turn (`input.voice`) — the VOICE TIER, forced over whatever the body
//   carries (decision D2, revised by the voice-lean tier 2026-08-27: the
//   contract's pin — haiku — at low effort / auto on EVERY leg; a typed
//   Voice-chat turn cannot pick another model, a daemon build with an old pin
//   cannot reintroduce it), and the row is neither read nor written: those are
//   the user's chips for the keyboard surface. No auto-buildout either — the
//   tier has no chips. The pin must actually FIT the session it resumes
//   (resuming a fat history on a small window is a guaranteed "Prompt is too
//   long" — a hands-free surface dying with nobody watching, live incident
//   2026-08-19). When the pin can't hold the occupancy the turn runs on
//   `VOICE_TIER_FALLBACK_MODEL` — {pin, fallback} is the entire voice model
//   universe; never the session's model, never the engine default. Never
//   persisted.

import type { Logger } from 'pino'
import type { Database } from '@vynel/db'
import {
  VOICE_TIER_MODE,
  VOICE_TIER_MODEL,
  VOICE_TIER_FALLBACK_MODEL,
  VOICE_TIER_THINKING_EFFORT,
} from '@vynel/contracts/chat/voice-tier'
import type { ThinkingEffortLevel } from '@vynel/contracts/chat/thinking-effort'
import { resolveTurnSessionSettings, type TurnSettingsInput } from '@vynel/chat'
import { findChatSessionById } from '@vynel/chat/repositories'
import { DEFAULT_SESSION_MODE, toPermissionMode, type SessionPermissionMode } from '@vynel/session'
import { fitPinnedModelToSession } from '@vynel/session/runtime'

export interface InteractiveTurnSettings {
  permissionMode: SessionPermissionMode
  /** undefined = the engine default decides. */
  model: string | undefined
  /** undefined = the SDK's adaptive default. */
  thinkingEffort: ThinkingEffortLevel | undefined
  /** Autopilot (D8) — undefined = never set on this session. */
  autoBuildout: boolean | undefined
}

export type InteractiveTurnSettingsInput = TurnSettingsInput & {
  voice?: boolean | undefined
  autoBuildout?: boolean | undefined
}

export function resolveInteractiveTurnSettings(
  db: Database,
  input: InteractiveTurnSettingsInput,
  target: {
    /** The session whose persisted settings apply (a keyboard turn) / the
     *  session the pin must fit (a voice turn). Null = a fresh conversation. */
    sessionId: string | null
    /** The swap-threshold knob every continuity consumer honors. */
    pressureThreshold?: number
    /** The voice A/B lever (`VYNEL_VOICE_TIER_MODEL`, env-validated to the
     *  tier's allowed pair) — replaces the PIN only; the fallback clamp and
     *  every other tier value stand. Ignored on keyboard turns. */
    voiceModelOverride?: string
  },
  deps: { logger: Logger },
): InteractiveTurnSettings {
  if (input.voice === true) return resolveVoiceTierSettings(db, target, deps)
  const row = target.sessionId !== null ? findChatSessionById(db, target.sessionId) : null
  const resolved = resolveTurnSessionSettings(input, row)
  return {
    permissionMode: toPermissionMode(resolved.mode ?? DEFAULT_SESSION_MODE),
    model: resolved.model,
    thinkingEffort: resolved.thinkingEffort,
    autoBuildout: resolved.autoBuildout,
  }
}

function resolveVoiceTierSettings(
  db: Database,
  target: { sessionId: string | null; pressureThreshold?: number; voiceModelOverride?: string },
  deps: { logger: Logger },
): InteractiveTurnSettings {
  const pinnedModel = target.voiceModelOverride ?? VOICE_TIER_MODEL
  let model: string | undefined = pinnedModel
  if (target.sessionId !== null) {
    const fit = fitPinnedModelToSession(db, {
      resumeSdkSessionId: target.sessionId,
      pinnedModel,
      ...(target.pressureThreshold !== undefined ? { threshold: target.pressureThreshold } : {}),
    })
    if (fit.wasReplaced) {
      // The clamp lands on the tier's OWN fallback, never "the session's
      // model" (voice-lean tier): {pin, fallback} is the entire voice model
      // universe — a chain that once ran something else must not smuggle it
      // back onto a spoken turn.
      deps.logger.info(
        { pinnedModel, model: VOICE_TIER_FALLBACK_MODEL, occupancyTokens: fit.occupancyTokens },
        'voice model pin cannot hold the session occupancy — running on the voice fallback model',
      )
      model = VOICE_TIER_FALLBACK_MODEL
    }
  }
  return {
    permissionMode: toPermissionMode(VOICE_TIER_MODE),
    model,
    thinkingEffort: VOICE_TIER_THINKING_EFFORT,
    autoBuildout: undefined,
  }
}
