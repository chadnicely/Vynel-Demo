import {
  LOCAL_STT_MODEL_IDS,
  LOCAL_TTS_MODEL_IDS,
  type LocalSttModelId,
  type LocalTtsModelId,
} from '@vynel/contracts/models/local-model-catalog'

// Which models the daemon speaks and hears with, and as whom. The user's pick
// lives in their preferences (Settings → Voice); env is the fallback for a
// daemon that boots before the engine, or a dev box with no preference set.

export interface VoiceSelection {
  readonly ttsModelId: LocalTtsModelId
  readonly sttModelId: LocalSttModelId
  readonly speakerId: number
}

export interface ReadVoiceSelectionOptions {
  readonly apiUrl: string
  readonly fallback: VoiceSelection
  readonly fetch?: typeof fetch
  readonly timeoutMs?: number
}

const READ_TIMEOUT_MS = 2_000

function isTtsModelId(value: unknown): value is LocalTtsModelId {
  return LOCAL_TTS_MODEL_IDS.some((id) => id === value)
}

function isSttModelId(value: unknown): value is LocalSttModelId {
  return LOCAL_STT_MODEL_IDS.some((id) => id === value)
}

/** Read the user's voice preferences from the engine; any field the engine
 *  does not answer (or answers with an id the catalog no longer has) keeps the
 *  fallback. An unreachable engine is the fallback whole — never a throw, the
 *  daemon must still come up. */
export async function readVoiceSelection(options: ReadVoiceSelectionOptions): Promise<VoiceSelection> {
  const fetchImpl = options.fetch ?? fetch
  try {
    const response = await fetchImpl(`${options.apiUrl}/users/me/preferences`, {
      signal: AbortSignal.timeout(options.timeoutMs ?? READ_TIMEOUT_MS),
    })
    if (!response.ok) return options.fallback
    const body = (await response.json()) as {
      voiceTtsModelId?: unknown
      voiceSttModelId?: unknown
      voiceSpeakerId?: unknown
    }
    return {
      ttsModelId: isTtsModelId(body.voiceTtsModelId) ? body.voiceTtsModelId : options.fallback.ttsModelId,
      sttModelId: isSttModelId(body.voiceSttModelId) ? body.voiceSttModelId : options.fallback.sttModelId,
      speakerId:
        typeof body.voiceSpeakerId === 'number' &&
        Number.isInteger(body.voiceSpeakerId) &&
        body.voiceSpeakerId >= 0
          ? body.voiceSpeakerId
          : options.fallback.speakerId,
    }
  } catch {
    return options.fallback
  }
}

export interface VoiceReloadPlan {
  /** The selection to run with — a picked model that is missing keeps the current one. */
  readonly selection: VoiceSelection
  readonly swapTts: boolean
  readonly swapStt: boolean
  readonly missing: string[]
}

/** What a reload must do: re-create only the engines whose model changed AND
 *  is on the disk; the speaker is a plain value and always follows the pick. */
export function planVoiceReload(
  current: VoiceSelection,
  next: VoiceSelection,
  isInstalled: (modelId: string) => boolean,
): VoiceReloadPlan {
  const missing: string[] = []
  let ttsModelId = current.ttsModelId
  let sttModelId = current.sttModelId
  if (next.ttsModelId !== current.ttsModelId) {
    if (isInstalled(next.ttsModelId)) ttsModelId = next.ttsModelId
    else missing.push(next.ttsModelId)
  }
  if (next.sttModelId !== current.sttModelId) {
    if (isInstalled(next.sttModelId)) sttModelId = next.sttModelId
    else missing.push(next.sttModelId)
  }
  return {
    selection: { ttsModelId, sttModelId, speakerId: next.speakerId },
    swapTts: ttsModelId !== current.ttsModelId,
    swapStt: sttModelId !== current.sttModelId,
    missing,
  }
}
