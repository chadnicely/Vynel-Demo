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
//
// Each chunk must be EXACTLY one 10 ms device period: writeToStream silently
// DROPS the non-period-aligned tail of every call — no error, no return
// value. The old 1024-sample chunk (512 stereo frames) lost 32 frames per
// write, splicing 6% of all audio away; a seeded-noise probe measured the
// skip at every packet, and period-aligned writes came back bit-perfect
// (2026-08-16, driver exonerated by the same probe).
const PERIODS_PER_SECOND = 100
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
  // One device period, in interleaved samples — the write granularity the
  // binding accepts without truncation (see the header comment).
  const writeChunkSamples =
    Math.max(1, Math.round(config.sampleRate / PERIODS_PER_SECOND)) * config.channels
  let pending: Float32Array[] = []
  let pendingOffset = 0
  let pendingSamples = 0

  // When the audio already handed to the device finishes playing. The queue
  // empties long before the device does — it holds ~340 ms — so pendingSamples
  // alone reads "idle" mid-line and the keepalive would inject silence INTO
  // the sentence, splitting words.
  let deviceBusyUntil = 0

  const pendingSeconds = (): number => pendingSamples / samplesPerSecond

  // One period assembled across queue-array boundaries — an utterance's arrays
  // rarely end period-aligned, and a partial write would lose its tail.
  const staging = new Float32Array(writeChunkSamples)
  const fillStaging = (): void => {
    let filled = 0
    let arrayIndex = 0
    let offset = pendingOffset
    while (filled < writeChunkSamples) {
      const source = pending[arrayIndex]!
      const take = Math.min(source.length - offset, writeChunkSamples - filled)
      staging.set(source.subarray(offset, offset + take), filled)
      filled += take
      offset += take
      if (offset >= source.length) {
        arrayIndex += 1
        offset = 0
      }
    }
  }
  const advanceQueueOnePeriod = (): void => {
    let toDrop = writeChunkSamples
    while (toDrop > 0) {
      const head = pending[0]!
      const take = Math.min(head.length - pendingOffset, toDrop)
      pendingOffset += take
      toDrop -= take
      if (pendingOffset >= head.length) {
        pending.shift()
        pendingOffset = 0
      }
    }
    pendingSamples -= writeChunkSamples
  }

  // Top the device up until it says it is full, then leave the rest for the
  // next tick. Only whole periods are ever written (sub-period remainders wait
  // for more audio, or for endSpeech's silence pad), and only a successful
  // write advances the cursor — a rejected period is re-offered, never lost.
  const pump = (): void => {
    while (handle !== null && pendingSamples >= writeChunkSamples) {
      fillStaging()
      try {
        cpal.writeToStream(handle, staging)
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
      advanceQueueOnePeriod()
      deviceBusyUntil =
        Math.max(performance.now(), deviceBusyUntil) + (writeChunkSamples / samplesPerSecond) * 1000
    }
  }
  const pacer = setInterval(pump, WRITE_TICK_MS)

  // KEEPALIVE_MS of silence as WHOLE periods, so the binding never truncates it.
  const keepAliveFrame = new Float32Array(writeChunkSamples * (KEEPALIVE_MS / WRITE_TICK_MS))
  let lastKeepAliveFaultLogAt = Number.NEGATIVE_INFINITY
  const keepAlive = setInterval(() => {
    if (handle === null) return
    // Real audio still in flight keeps the stream warm by itself, and silence
    // queued behind it would land inside the line. A held SUB-period tail
    // (< 10 ms, waiting for the next sentence or endSpeech's pad) must not
    // suppress the trickle — through a long think-gap that would let the
    // stream go cold, the exact failure keepalive exists for.
    const now = performance.now()
    if (pendingSamples >= writeChunkSamples || now < deviceBusyUntil) return
    if (now - lastRealEmitAt < KEEPALIVE_IDLE_MS) return
    try {
      cpal.writeToStream(handle, keepAliveFrame)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Buffer full means the stream is plainly not cold — the point of the
      // trickle. Anything else is a real device fault the 50 ms cadence would
      // otherwise hide until the next speak; log it, throttled.
      if (!message.includes('buffer full') && now - lastKeepAliveFaultLogAt > 5_000) {
        lastKeepAliveFaultLogAt = now
        logger.warn({ sink: label, device: device.name, error: message }, 'keepalive write failed')
      }
      return
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
      // Period-align the line's tail: the pump holds a sub-period remainder
      // (a partial write would be silently truncated), so pad it with silence
      // up to one whole period and let it flush.
      const remainder = pendingSamples % writeChunkSamples
      if (remainder > 0) {
        const pad = new Float32Array(writeChunkSamples - remainder)
        pending.push(pad)
        pendingSamples += pad.length
        pump()
      }
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
