import type { VoiceEngine } from '@vynel/voice-engine'
import { LineSpeaker, SpokenEchoFilter, type StreamedLine } from '@vynel/voice'
import { SpeechLane } from './speech-lane.js'
import type { VoiceSessionIo } from './voice-session-types.js'

// The daemon's ONE voice on its own speaker: the shared LineSpeaker (sentence
// pipelining, drain waits, the cancel contract) behind a lane that serializes
// its users — a turn's streamed reply, the next turn's after a barge-in, relay
// lines — and an echo memory of everything it says, so the open mic never
// takes the daemon's own words for a person's (voice-realtime VR2).

export class DaemonSpeaker {
  readonly echoFilter = new SpokenEchoFilter()
  readonly #lineSpeaker: LineSpeaker
  readonly #lane = new SpeechLane()

  constructor(synthesizer: VoiceEngine, io: VoiceSessionIo, voiceId: number | undefined) {
    this.#lineSpeaker = new LineSpeaker({
      synthesize: (sentence) =>
        synthesizer.synthesize(sentence, voiceId !== undefined ? { voiceId } : undefined),
      emitAudio: (audio) => io.emitAudio(audio),
      endSpeech: () => io.endSpeech(),
      cutPlayback: () => io.cutPlayback(),
    })
  }

  /** Speak a whole line (a relay line) once the lane is free; resolves when
   *  the device truly finished it. Remembered for the echo filter until the
   *  return window past its end. */
  async speakLine(text: string): Promise<void> {
    const spoken = this.echoFilter.remember(text)
    try {
      await this.#lane.reserve(() => this.#lineSpeaker.speakLine(text))
    } finally {
      spoken.end()
    }
  }

  /** Open a streamed line (a turn's reply) once the lane is free; the lane is
   *  held until the line is over. The caller remembers what it pushes. */
  openStreamedLine(): Promise<StreamedLine> {
    return new Promise<StreamedLine>((resolve, reject) => {
      void this.#lane.reserve(() => {
        let line: StreamedLine
        try {
          line = this.#lineSpeaker.speakStreamed()
        } catch (error) {
          reject(error)
          throw error
        }
        resolve(line)
        return line.outcome
      })
    })
  }

  /** The device finished (or discarded) all queued audio. */
  notifyPlaybackDrained(): void {
    this.#lineSpeaker.notifyPlaybackDrained()
  }
}
