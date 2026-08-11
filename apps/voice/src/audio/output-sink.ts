import type { Logger } from 'pino'
import type { PcmAudio } from '@vynel/voice-engine'
import { cpal, type CpalDevice, type CpalStreamConfig, type CpalStreamHandle } from './cpal.js'
import { monoToChannels, resampleLinear } from './audio-format.js'

// The ONE home for playback: open an output stream on a device and write mono
// PCM converted to that sink's own config. The primary speaker is one
// instance; each call's Cable-A voice feed (Part B) is another — keepalive and
// the drain estimate are per-sink by construction. Config comes in
// pre-resolved (selectDeviceConfig owns the wrong-direction fallback).

// The device keeps playing after the last frame is written; wait this long
// past the estimated end before declaring the sink drained (the mic-reopen
// echo defense reads this). LIVE-TUNE territory (needs a real speaker).
const PLAYBACK_TAIL_MS = 350
// Keep the WASAPI output stream WARM. An idle output stream goes cold on
// Windows and the next fresh write produces NO SOUND — feed a steady trickle
// of silence between real audio so the stream never sleeps.
const KEEPALIVE_MS = 50
// Skip the trickle while real audio flowed this recently — it keeps the
// stream warm on its own, and queued silence behind it would gap playback.
const KEEPALIVE_IDLE_MS = 250

export interface OutputSinkSource {
  device: CpalDevice
  config: CpalStreamConfig
}

export interface OutputSink {
  emitAudio(pcm: PcmAudio): void
  endSpeech(): void
  /** Discard everything queued on the device and declare playback over NOW —
   *  the barge-in primitive. The sink stays usable for the next speak.
   *  Mid-line callers must ALSO cancel their emit loop and suppress the
   *  trailing `endSpeech` (C2's line-speaker owns that) — a trailing
   *  `endSpeech` after a cut arms a fresh drain and double-fires `onDrained`. */
  cutPlayback(): void
  stop(): void
}

export function openOutputSink(
  logger: Logger,
  label: string,
  source: OutputSinkSource,
  onDrained: () => void,
): OutputSink {
  const { device, config } = source
  // The callback is required by the binding even for output streams.
  let handle: CpalStreamHandle | null = cpal.createStream(device.deviceId, false, config, () => {})
  let playbackStartedAt: number | null = null
  let queuedSeconds = 0
  let drainTimer: ReturnType<typeof setTimeout> | null = null
  let lastRealEmitAt = 0

  // ~KEEPALIVE_MS of silence, in the sink's own interleaved format.
  const keepAliveFrame = new Float32Array(
    Math.max(1, Math.round((config.sampleRate * config.channels * KEEPALIVE_MS) / 1000)),
  )
  const keepAlive = setInterval(() => {
    if (handle === null) return
    if (performance.now() - lastRealEmitAt < KEEPALIVE_IDLE_MS) return
    cpal.writeToStream(handle, keepAliveFrame)
  }, KEEPALIVE_MS)

  logger.info({ sink: label, device: device.name }, 'output sink opened')

  return {
    emitAudio(pcm: PcmAudio): void {
      // A call sink can be stopped while a speak still drains — swallow the
      // tail instead of writing to a closed native handle.
      if (handle === null) return
      const atSinkRate = resampleLinear(pcm.samples, pcm.sampleRate, config.sampleRate)
      const interleaved = monoToChannels(atSinkRate, config.channels)
      if (playbackStartedAt === null) {
        playbackStartedAt = performance.now()
        queuedSeconds = 0
      }
      queuedSeconds += pcm.samples.length / pcm.sampleRate
      lastRealEmitAt = performance.now()
      cpal.writeToStream(handle, interleaved)
    },
    endSpeech(): void {
      const startedAt = playbackStartedAt ?? performance.now()
      const playedSeconds = (performance.now() - startedAt) / 1000
      const remainingMs = Math.max(0, (queuedSeconds - playedSeconds) * 1000) + PLAYBACK_TAIL_MS
      if (drainTimer !== null) clearTimeout(drainTimer)
      drainTimer = setTimeout(() => {
        drainTimer = null
        playbackStartedAt = null
        queuedSeconds = 0
        onDrained()
      }, remainingMs)
    },
    cutPlayback(): void {
      if (handle === null) return
      // Close+reopen is the only true DISCARD: the runtime's pauseStream HOLDS
      // queued audio and would replay the cut tail on resume.
      const hadPlayback = playbackStartedAt !== null || drainTimer !== null
      const closing = handle
      // Null-first: if the device vanished and anything below throws, every
      // guard (emit swallow, keepalive skip, stop, repeat cut) must see a dead
      // sink — a lingering closed handle would crash the 50 ms keepalive tick.
      handle = null
      if (drainTimer !== null) {
        clearTimeout(drainTimer)
        drainTimer = null
      }
      playbackStartedAt = null
      queuedSeconds = 0
      try {
        cpal.closeStream(closing)
      } catch (error) {
        logger.debug(
          { sink: label, error: error instanceof Error ? error.message : String(error) },
          'closing the cut stream failed (device likely gone) — continuing to reopen',
        )
      }
      try {
        handle = cpal.createStream(device.deviceId, false, config, () => {})
      } catch (error) {
        logger.error(
          { sink: label, device: device.name, error: error instanceof Error ? error.message : String(error) },
          'reopen after cut failed — this sink is dead until the daemon restarts',
        )
      }
      // Only a cut that interrupted REAL playback resolves the drain waiter — a
      // spurious onDrained here would leave a stale pending flag that reopens
      // the mic into the NEXT speak's tail.
      if (hadPlayback) onDrained()
    },
    // Idempotent for the same reason capture-stream's stop is: the call
    // registry will have racing stop paths.
    stop(): void {
      clearInterval(keepAlive)
      if (drainTimer !== null) clearTimeout(drainTimer)
      if (handle === null) return
      cpal.closeStream(handle)
      handle = null
    },
  }
}
