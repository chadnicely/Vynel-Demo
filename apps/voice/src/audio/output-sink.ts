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
// The binding's write buffer is small and bounded, and it THROWS
// "Failed to write to stream: buffer full" rather than blocking. Handing it a
// whole utterance therefore aborted the line partway through — the audible
// symptom was speech cutting out constantly. So the sink queues audio and
// feeds it in small chunks, treating "buffer full" as backpressure: the
// device's own drain rate is the clock, which needs no tuning to match it.
// node-cpal's own example uses the same shape (~1024 samples, short sleep).
const WRITE_CHUNK_SAMPLES = 1024
const WRITE_TICK_MS = 10

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

  // Audio accepted from the caller but not yet handed to the device, plus how
  // far into the head chunk the pump has read.
  const samplesPerSecond = config.sampleRate * config.channels
  let pending: Float32Array[] = []
  let pendingOffset = 0
  let pendingSamples = 0

  // When the audio already handed to the device finishes playing. The queue
  // empties long before the device does — it holds ~340 ms — so pendingSamples
  // alone reads "idle" mid-line and the keepalive would inject silence INTO
  // the sentence, splitting words.
  let deviceBusyUntil = 0

  const pendingSeconds = (): number => pendingSamples / samplesPerSecond

  // Top the device up until it says it is full, then leave the rest for the
  // next tick. Only a successful write advances the cursor, so a rejected chunk
  // is re-offered rather than lost.
  const pump = (): void => {
    while (handle !== null && pending.length > 0) {
      const head = pending[0]!
      const take = Math.min(head.length - pendingOffset, WRITE_CHUNK_SAMPLES)
      // Copy rather than subarray — the binding reads a raw buffer and must not
      // depend on a view's byte offset.
      try {
        cpal.writeToStream(handle, head.slice(pendingOffset, pendingOffset + take))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('buffer full')) return
        // Anything else is a real device fault: drop the line rather than spin
        // on a stream that will never accept it again.
        logger.error({ sink: label, device: device.name, error: message }, 'output write failed — dropping queued audio')
        pending = []
        pendingOffset = 0
        pendingSamples = 0
        return
      }
      pendingOffset += take
      pendingSamples -= take
      deviceBusyUntil = Math.max(performance.now(), deviceBusyUntil) + (take / samplesPerSecond) * 1000
      if (pendingOffset >= head.length) {
        pending.shift()
        pendingOffset = 0
      }
    }
  }
  const pacer = setInterval(pump, WRITE_TICK_MS)

  // ~KEEPALIVE_MS of silence, in the sink's own interleaved format.
  const keepAliveFrame = new Float32Array(
    Math.max(1, Math.round((config.sampleRate * config.channels * KEEPALIVE_MS) / 1000)),
  )
  const keepAlive = setInterval(() => {
    if (handle === null) return
    // Real audio still in flight keeps the stream warm by itself, and silence
    // queued behind it would land inside the line.
    const now = performance.now()
    if (pendingSamples > 0 || now < deviceBusyUntil) return
    if (now - lastRealEmitAt < KEEPALIVE_IDLE_MS) return
    try {
      cpal.writeToStream(handle, keepAliveFrame)
    } catch {
      return // buffer full — the stream is plainly not cold, which is the point
    }
    // Count the trickle against the device too, so the guard above rate-limits
    // it to one frame at a time. Otherwise silence stacks up to the buffer's
    // full ~340 ms and the next sentence has to wait behind all of it.
    deviceBusyUntil = Math.max(now, deviceBusyUntil) + KEEPALIVE_MS
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
      pending.push(interleaved)
      pendingSamples += interleaved.length
      pump()
    },
    endSpeech(): void {
      const startedAt = playbackStartedAt ?? performance.now()
      const playedSeconds = (performance.now() - startedAt) / 1000
      // Audio still queued here has not even reached the device yet, so it
      // floors the estimate — without it a paced line declares itself drained
      // early and the mic reopens into its own tail.
      const remainingMs =
        Math.max(0, queuedSeconds - playedSeconds, pendingSeconds()) * 1000 + PLAYBACK_TAIL_MS
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
      // Audio not yet handed over is the part a cut can genuinely take back —
      // dropping it here is what makes barge-in immediate rather than merely
      // closing the device on a tail already inside it.
      pending = []
      pendingOffset = 0
      pendingSamples = 0
      deviceBusyUntil = 0
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
      clearInterval(pacer)
      pending = []
      pendingSamples = 0
      if (drainTimer !== null) clearTimeout(drainTimer)
      if (handle === null) return
      cpal.closeStream(handle)
      handle = null
    },
  }
}
