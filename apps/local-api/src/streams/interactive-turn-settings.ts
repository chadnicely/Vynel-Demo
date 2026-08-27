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
  DEFAULT_VOICE_TIER_THINKING,
  isVoiceTierModel,
  isVoiceTierThinking,
  type VoiceTierModel,
  type VoiceTierThinking,
} from '@vynel/contracts/chat/voice-tier'
import type { ThinkingEffortLevel } from '@vynel/contracts/chat/thinking-effort'
import { resolveTurnSessionSettings, type TurnSettingsInput } from '@vynel/chat'
import { findChatSessionById } from '@vynel/chat/repositories'
import { findPreferenceForUser } from '@vynel/db/repositories/users'
import { DEFAULT_SESSION_MODE, toPermissionMode, type SessionPermissionMode } from '@vynel/session'
import { fitPinnedModelToSession } from '@vynel/session/runtime'

export interface InteractiveTurnSettings {
  permissionMode: SessionPermissionMode
  /** undefined = the engine default decides. */
  model: string | undefined
  /** undefined = the SDK's adaptive default. */
  thinkingEffort: ThinkingEffortLevel | undefined
  /** Thinking OFF for this turn (the voice tier's `voiceTierThinking: 'off'`,
   *  the fast default) — the provider drops any effort beside it. undefined =
   *  keyboard turns, which never set it. */
  disableThinking: boolean | undefined
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
    /** The turn's user — the voice branch reads the Settings → Voice tier
     *  preferences (`voiceTierModel` / `voiceTierThinking`) by it. Omitted
     *  (older callers, keyboard turns) = the tier's contract defaults. */
    userId?: string
    /** The swap-threshold knob every continuity consumer honors. */
    pressureThreshold?: number
    /** The voice A/B lever (`VYNEL_VOICE_TIER_MODEL`, env-validated to the
     *  tier's allowed pair) — the dev/support override, and it OUTRANKS the
     *  stored preference so support can force a model regardless of what the
     *  user picked. The fallback clamp and every other tier value stand.
     *  Ignored on keyboard turns. */
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
    disableThinking: undefined,
    autoBuildout: resolved.autoBuildout,
  }
}

/** The stored Settings → Voice tier picks, guard-validated exactly like
 *  `getUserPreferences` (a malformed or off-tier row reads as never chosen).
 *  Read directly off the two rows — the voice tier must not pay the full
 *  preference-list read on every spoken turn. */
function readVoiceTierPreferences(
  db: Database,
  userId: string | undefined,
): { model: VoiceTierModel | null; thinking: VoiceTierThinking | null } {
  if (userId === undefined) return { model: null, thinking: null }
  const modelRow = findPreferenceForUser(db, userId, 'voiceTierModel')
  const thinkingRow = findPreferenceForUser(db, userId, 'voiceTierThinking')
  const model = modelRow !== null ? safelyParse(modelRow.preferenceValue) : null
  const thinking = thinkingRow !== null ? safelyParse(thinkingRow.preferenceValue) : null
  return {
    model: isVoiceTierModel(model) ? model : null,
    thinking: isVoiceTierThinking(thinking) ? thinking : null,
  }
}

function safelyParse(rawValue: string): unknown {
  try {
    return JSON.parse(rawValue)
  } catch {
    return null
  }
}

function resolveVoiceTierSettings(
  db: Database,
  target: {
    sessionId: string | null
    userId?: string
    pressureThreshold?: number
    voiceModelOverride?: string
  },
  deps: { logger: Logger },
): InteractiveTurnSettings {
  const preference = readVoiceTierPreferences(db, target.userId)
  // Pin precedence: the env lever (support wins) → the user's Settings →
  // Voice pick → the contract default.
  const pinnedModel = target.voiceModelOverride ?? preference.model ?? VOICE_TIER_MODEL
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
  // The user's THINKING pick (default 'off' — the fast tier): 'off' turns
  // extended thinking off entirely for the turn; a real level runs it at that
  // effort. The legacy effort the senders still transmit is ignored here.
  const thinking = preference.thinking ?? DEFAULT_VOICE_TIER_THINKING
  return {
    permissionMode: toPermissionMode(VOICE_TIER_MODE),
    model,
    thinkingEffort: thinking === 'off' ? undefined : thinking,
    disableThinking: thinking === 'off',
    autoBuildout: undefined,
  }
}
