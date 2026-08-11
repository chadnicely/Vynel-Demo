import type { Logger } from 'pino'
import type { PcmAudio, VoiceActivityDetector } from '@vynel/voice-engine'
import { LineSpeaker, type SpokenAudio } from '@vynel/voice'
import type { OutputSink } from '../audio/output-sink.js'
import type { CallDescriptor, CallLoopHooks } from './call-registry.js'
import type { CallSessionClient } from './call-session-client.js'
import { CallConversation } from './call-conversation.js'

// The registry↔conversation glue: one CallConversation per live call, created
// on the registry's start hook and torn down on its end hook. A call started
// WITHOUT a sessionId (the raw /calls endpoint, dev probing) gets audio but no
// brain — logged loudly, not an error: the sanctioned path is the start_call
// tool, which spawns the session first and passes its id through.

export interface CallConversationHostDeps {
  readonly logger: Logger
  readonly assistantName: string
  readonly sessionClient: CallSessionClient
  readonly createVad: () => VoiceActivityDetector
  readonly transcribe: (audio: PcmAudio) => Promise<string>
  readonly synthesize: (sentence: string) => Promise<SpokenAudio>
  readonly findCallSink: (callId: string) => OutputSink | null
}

export interface CallConversationHost extends CallLoopHooks {
  /** Speak a verbatim line into one live call (the conductor's voice). False =
   *  no such call, or it was started without a conversation. */
  speakIntoCall(callId: string, text: string): boolean
  stopAll(): void
}

export function createCallConversationHost(deps: CallConversationHostDeps): CallConversationHost {
  const conversations = new Map<string, CallConversation>()

  return {
    onCallStarted(descriptor: CallDescriptor): void {
      if (descriptor.sessionId === undefined) {
        deps.logger.warn(
          { callId: descriptor.callId, label: descriptor.label },
          'call started without a session — audio is open but nobody is listening; start calls through the start_call tool',
        )
        return
      }
      const sink = deps.findCallSink(descriptor.callId)
      if (sink === null) {
        deps.logger.error({ callId: descriptor.callId }, 'started call has no sink — conversation not attached')
        return
      }
      const lineSpeaker = new LineSpeaker({
        synthesize: deps.synthesize,
        emitAudio: (audio) => sink.emitAudio(audio),
        endSpeech: () => sink.endSpeech(),
        cutPlayback: () => sink.cutPlayback(),
      })
      conversations.set(
        descriptor.callId,
        new CallConversation({
          logger: deps.logger,
          callId: descriptor.callId,
          mode: descriptor.mode,
          sessionId: descriptor.sessionId,
          assistantName: deps.assistantName,
          vad: deps.createVad(),
          transcribe: deps.transcribe,
          lineSpeaker,
          sessionClient: deps.sessionClient,
        }),
      )
    },
    onCallAudio(callId: string, audio: PcmAudio): void {
      conversations.get(callId)?.pushAudio(audio)
    },
    onCallDrained(callId: string): void {
      conversations.get(callId)?.notifyPlaybackDrained()
    },
    onCallEnded(callId: string): void {
      conversations.get(callId)?.stop()
      conversations.delete(callId)
    },
    speakIntoCall(callId: string, text: string): boolean {
      const conversation = conversations.get(callId)
      if (conversation === undefined) return false
      conversation.speakDirect(text)
      return true
    },
    stopAll(): void {
      for (const conversation of conversations.values()) conversation.stop()
      conversations.clear()
    },
  }
}
