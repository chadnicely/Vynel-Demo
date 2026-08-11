import { randomUUID } from 'node:crypto'
import type { Logger } from 'pino'
import type { PcmAudio } from '@vynel/voice-engine'
import { cpal } from '../audio/cpal.js'
import { findDeviceByName } from '../audio/device-selection.js'
import type { SelectedDeviceConfig } from '../audio/device-selection.js'
import { openCaptureStream, type CaptureStream } from '../audio/capture-stream.js'
import { openOutputSink, type OutputSink } from '../audio/output-sink.js'
import type { CallMode } from '@vynel/voice'

// The daemon's live-call roster: callId → the call's audio plumbing (Cable B
// capture in, Cable A sink out). Concurrency = the env cable-pair INVENTORY:
// each installed pair carries one live call; a start picks the first free
// pair and 'pair-busy' fires only when every pair is held.
//
// Two deliberate contrasts with the primary mic/speaker path:
//  - Devices resolve STRICTLY at start-call time — no fallback to the system
//    defaults. Falling back would capture the user's real mic and speak over
//    their real speakers mid-meeting. Missing cable = typed, actionable error.
//  - Resolution happens per start, not at boot, so installing the cable never
//    requires a daemon restart.

// One home for the mode union: the pure policy in @vynel/voice owns it; the
// registry re-exports for its HTTP-endpoint consumers.
export type { CallMode } from '@vynel/voice'

export interface CallDescriptor {
  readonly callId: string
  readonly label: string
  readonly mode: CallMode
  /** The per-call spawned session driving the conversation — absent only on
   *  raw /calls starts (dev probing); the start_call tool always passes it. */
  readonly sessionId?: string
  readonly startedAtIso: string
}

export type CallRegistryErrorKind = 'not-configured' | 'device-missing' | 'pair-busy' | 'unknown-call'

export class CallRegistryError extends Error {
  readonly kind: CallRegistryErrorKind

  constructor(kind: CallRegistryErrorKind, message: string) {
    super(message)
    this.name = 'CallRegistryError'
    this.kind = kind
  }
}

export interface CallCablePair {
  /** Cable B's capture end — what the call app plays INTO (participants' audio). */
  readonly inputName: string
  /** Cable A's playback end — what the call app uses as its microphone. */
  readonly outputName: string
}

export interface StartCallRequest {
  readonly label: string
  readonly mode: CallMode
  readonly sessionId?: string | undefined
}

interface LiveCall {
  readonly descriptor: CallDescriptor
  readonly capture: CaptureStream
  readonly sink: OutputSink
  /** Which inventory pair this call holds — freed when the call ends. */
  readonly pairIndex: number
}

/** The seams the call loop claims — lifecycle + both directions of a live
 *  call's audio. Until bound, call audio is discarded and events go nowhere. */
export interface CallLoopHooks {
  onCallStarted(descriptor: CallDescriptor): void
  onCallAudio(callId: string, audio: PcmAudio): void
  /** The call sink finished (or cut) its queued playback — the loop's drain wait. */
  onCallDrained(callId: string): void
  onCallEnded(callId: string): void
}

export class CallRegistry {
  readonly #logger: Logger
  readonly #pairs: readonly CallCablePair[]
  readonly #calls = new Map<string, LiveCall>()
  #loopHooks: CallLoopHooks | null = null

  constructor(logger: Logger, pairs: readonly CallCablePair[]) {
    this.#logger = logger
    this.#pairs = pairs
  }

  bindCallLoop(hooks: CallLoopHooks): void {
    this.#loopHooks = hooks
  }

  startCall(request: StartCallRequest): CallDescriptor {
    if (this.#pairs.length === 0) {
      throw new CallRegistryError(
        'not-configured',
        'call audio is not configured — set VYNEL_CALL_INPUT_DEVICE (Cable B capture end) and ' +
          'VYNEL_CALL_OUTPUT_DEVICE (Cable A playback end) to the installed virtual-cable device names',
      )
    }
    const heldPairIndexes = new Set([...this.#calls.values()].map((call) => call.pairIndex))
    const pairIndex = this.#pairs.findIndex((_pair, index) => !heldPairIndexes.has(index))
    if (pairIndex === -1) {
      const holders = [...this.#calls.values()]
        .map((call) => `${call.descriptor.callId} ("${call.descriptor.label}")`)
        .join(', ')
      throw new CallRegistryError(
        'pair-busy',
        `all ${this.#pairs.length} cable pair(s) are in use — by ${holders} — end one first`,
      )
    }
    const pair = this.#pairs[pairIndex]!

    const devices = cpal.getDevices()
    const input = this.#resolveCableEnd('input', pair.inputName, devices)
    const output = this.#resolveCableEnd('output', pair.outputName, devices)

    const callId = randomUUID()
    const descriptor: CallDescriptor = {
      callId,
      label: request.label,
      mode: request.mode,
      ...(request.sessionId !== undefined ? { sessionId: request.sessionId } : {}),
      startedAtIso: new Date().toISOString(),
    }
    const sink = openOutputSink(this.#logger, `call:${callId}`, output, () =>
      this.#loopHooks?.onCallDrained(callId),
    )
    let capture: CaptureStream
    try {
      capture = openCaptureStream(this.#logger, `call:${callId}`, input, (audio) => {
        this.#loopHooks?.onCallAudio(callId, audio)
      })
    } catch (error) {
      // The sink is live already (stream + keepalive interval) — an orphan here
      // would leak both forever, unreachable by endCall/stopAll.
      sink.stop()
      throw new CallRegistryError(
        'device-missing',
        `call input stream failed to open on "${pair.inputName}" — ` +
          (error instanceof Error ? error.message : String(error)),
      )
    }
    this.#calls.set(callId, { descriptor, capture, sink, pairIndex })
    this.#logger.info({ callId, label: request.label, mode: request.mode, pairIndex }, 'call started')
    this.#loopHooks?.onCallStarted(descriptor)
    return descriptor
  }

  endCall(callId: string): CallDescriptor {
    const call = this.#calls.get(callId)
    if (call === undefined) {
      throw new CallRegistryError('unknown-call', `no live call ${callId} — it may have already ended`)
    }
    this.#calls.delete(callId)
    // The conversation stops FIRST, while the sink is still alive — its cancel
    // resolves an in-flight drain wait through the cut round-trip. Stopping
    // the sink first would clear the drain timer without firing and wedge the
    // wait forever (the cut no-ops on a dead handle).
    this.#loopHooks?.onCallEnded(callId)
    call.capture.stop()
    call.sink.stop()
    this.#logger.info({ callId, label: call.descriptor.label }, 'call ended')
    return call.descriptor
  }

  listCalls(): CallDescriptor[] {
    return [...this.#calls.values()].map((call) => call.descriptor)
  }

  /** The sink of one live call — C2's speak path. */
  findCallSink(callId: string): OutputSink | null {
    return this.#calls.get(callId)?.sink ?? null
  }

  stopAll(): void {
    for (const callId of [...this.#calls.keys()]) this.endCall(callId)
  }

  // Strict: a call NEVER falls back to a default device (that would be the
  // user's real mic/speakers mid-meeting) — a miss names what IS available.
  #resolveCableEnd(
    direction: 'input' | 'output',
    name: string,
    devices: ReturnType<typeof cpal.getDevices>,
  ): SelectedDeviceConfig {
    const device = findDeviceByName(devices, name)
    if (device === null) {
      throw new CallRegistryError(
        'device-missing',
        `call ${direction} device "${name}" not found — is the virtual cable installed? ` +
          `Available: ${devices.map((enumerated) => enumerated.name).join(', ')}`,
      )
    }
    try {
      const config =
        direction === 'input'
          ? cpal.getDefaultInputConfig(device.deviceId)
          : cpal.getDefaultOutputConfig(device.deviceId)
      return { device, config }
    } catch (error) {
      throw new CallRegistryError(
        'device-missing',
        `call ${direction} device "${name}" can't ${direction === 'input' ? 'record' : 'play'} — ` +
          `likely the other end of the cable (${error instanceof Error ? error.message : String(error)})`,
      )
    }
  }
}
