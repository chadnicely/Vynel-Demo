import { randomUUID } from 'node:crypto'
import type { Logger } from 'pino'
import type { PcmAudio } from '@vynel/voice-engine'
import { cpal } from '../audio/cpal.js'
import { findDeviceByName, normalizeDeviceName } from '../audio/device-selection.js'
import type { SelectedDeviceConfig } from '../audio/device-selection.js'
import { openCaptureStream, type CaptureStream } from '../audio/capture-stream.js'
import { openProcessLoopbackCapture, type ProcessLoopbackSource } from '../audio/process-loopback-capture.js'
import { openOutputSink, type OutputSink } from '../audio/output-sink.js'
import { discoverVynelCallPairs } from './call-cable-discovery.js'
import type { CallMode } from '@vynel/voice'

// The daemon's live-call roster: callId → the call's audio plumbing (Cable B
// capture in, Cable A sink out). Concurrency = the cable-pair INVENTORY:
// auto-discovered "Vynel Call <n> Ears/Voice" devices first (our own virtual
// devices need zero config), then the env pairs as the fallback — deduped, so
// an env var naming a discovered device never doubles capacity. Each pair
// carries one live call; a start picks the first free pair and 'pair-busy'
// fires only when every pair is held. Discovery re-runs per start (same rule
// as device resolution: installing a device never requires a daemon restart).
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
  /** The capture end — what the call app plays INTO (participants' audio). When
   *  absent the call is HEARD via process-loopback of the call app's process
   *  (Windows driver path: no capture device, a `capturePid` is required at
   *  start). */
  readonly inputName?: string
  /** The render device Vynel plays its voice into (the call app's microphone). */
  readonly outputName: string
}

export interface StartCallRequest {
  readonly label: string
  readonly mode: CallMode
  readonly sessionId?: string | undefined
  /** The call app's process id to capture, for a loopback-ears pair (one with
   *  no `inputName`). Ignored by device-cable pairs. */
  readonly capturePid?: number | undefined
}

interface LiveCall {
  readonly descriptor: CallDescriptor
  readonly capture: CaptureStream
  readonly sink: OutputSink
  /** Which inventory pair this call holds — freed when the call ends. Keyed by
   *  the pair's device names (not position): discovery makes the inventory
   *  dynamic between starts, so positions don't stay stable. */
  readonly pairKey: string
}

// Inventory identity — an env entry duplicating a discovered pair must not
// double capacity, and a held pair must stay held across re-discovery.
function cablePairKey(pair: CallCablePair): string {
  const ears = pair.inputName !== undefined ? normalizeDeviceName(pair.inputName) : '(loopback)'
  return `${ears}::${normalizeDeviceName(pair.outputName)}`
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
  readonly #envPairs: readonly CallCablePair[]
  readonly #calls = new Map<string, LiveCall>()
  #loopHooks: CallLoopHooks | null = null

  constructor(logger: Logger, envPairs: readonly CallCablePair[]) {
    this.#logger = logger
    this.#envPairs = envPairs
  }

  bindCallLoop(hooks: CallLoopHooks): void {
    this.#loopHooks = hooks
  }

  startCall(request: StartCallRequest): CallDescriptor {
    const devices = cpal.getDevices()
    const inventory = this.#buildPairInventory(devices)
    if (inventory.length === 0) {
      throw new CallRegistryError(
        'not-configured',
        'call audio is not configured — no "Vynel Call <n> Ears/Voice" devices were discovered ' +
          'and no cable env vars are set: install Vynel call devices, or set ' +
          'VYNEL_CALL_INPUT_DEVICE (Cable B capture end) and VYNEL_CALL_OUTPUT_DEVICE ' +
          '(Cable A playback end) to the installed virtual-cable device names',
      )
    }
    const heldKeys = new Set([...this.#calls.values()].map((call) => call.pairKey))
    const pair = inventory.find((candidate) => !heldKeys.has(cablePairKey(candidate)))
    if (pair === undefined) {
      const holders = [...this.#calls.values()]
        .map((call) => `${call.descriptor.callId} ("${call.descriptor.label}")`)
        .join(', ')
      throw new CallRegistryError(
        'pair-busy',
        `all ${inventory.length} cable pair(s) are in use — by ${holders} — end one first`,
      )
    }

    // A loopback-ears pair hears the call by process-loopback — no capture
    // device. With a capturePid it captures that app (+ children); WITHOUT one
    // it captures ALL system audio EXCEPT the daemon's own process (exclude
    // mode on our own pid) — which is the call participants, echo-free (Vynel's
    // own voice, rendered by this process, is the one thing excluded), and
    // needs no app detection.
    const earsByLoopback = pair.inputName === undefined
    const loopbackSource: ProcessLoopbackSource | undefined = !earsByLoopback
      ? undefined
      : request.capturePid !== undefined
        ? { processId: request.capturePid, includeProcessTree: true }
        : { processId: process.pid, includeProcessTree: false }
    const input = earsByLoopback ? undefined : this.#resolveCableEnd('input', pair.inputName!, devices)
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
    const onCallAudio = (audio: PcmAudio): void => this.#loopHooks?.onCallAudio(callId, audio)
    let capture: CaptureStream
    try {
      capture =
        loopbackSource !== undefined
          ? openProcessLoopbackCapture(this.#logger, `call:${callId}`, loopbackSource, onCallAudio)
          : openCaptureStream(this.#logger, `call:${callId}`, input!, onCallAudio)
    } catch (error) {
      // The sink is live already (stream + keepalive interval) — an orphan here
      // would leak both forever, unreachable by endCall/stopAll.
      sink.stop()
      const earsLabel =
        loopbackSource === undefined
          ? `capture device "${pair.inputName}"`
          : loopbackSource.includeProcessTree
            ? `process-loopback pid ${loopbackSource.processId}`
            : 'process-loopback (system audio except self)'
      throw new CallRegistryError(
        'device-missing',
        `call ears failed to open (${earsLabel}) — ` +
          (error instanceof Error ? error.message : String(error)),
      )
    }
    this.#calls.set(callId, { descriptor, capture, sink, pairKey: cablePairKey(pair) })
    this.#logger.info(
      {
        callId,
        label: request.label,
        mode: request.mode,
        ears:
          loopbackSource === undefined
            ? pair.inputName
            : loopbackSource.includeProcessTree
              ? `loopback:pid ${loopbackSource.processId}`
              : 'loopback:system-except-self',
        voice: pair.outputName,
      },
      'call started',
    )
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

  // Discovered pairs come first — once Vynel's own devices exist, env config
  // is dead weight; env stays as the fallback (and the only Windows path until
  // the driver ships). Dedupe keeps a doubled entry from doubling capacity.
  #buildPairInventory(devices: ReturnType<typeof cpal.getDevices>): CallCablePair[] {
    const discovered = discoverVynelCallPairs(devices)
    if (discovered.orphanNames.length > 0) {
      this.#logger.warn(
        { orphanNames: discovered.orphanNames },
        'vynel call devices missing their partner end — not claimable as pairs',
      )
    }
    const inventory: CallCablePair[] = []
    const seenPairKeys = new Set<string>()
    const seenEndNames = new Set<string>()
    for (const pair of [...discovered.pairs, ...this.#envPairs]) {
      if (seenPairKeys.has(cablePairKey(pair))) continue // env naming a discovered pair — expected, silent
      // A physical device end carries ONE call — a pair reusing an earlier
      // pair's end would cross-bleed audio. Loopback ears has no capture
      // device, so only its Voice end takes a slot.
      const ends = [pair.outputName, ...(pair.inputName !== undefined ? [pair.inputName] : [])].map(
        normalizeDeviceName,
      )
      if (ends.some((end) => seenEndNames.has(end))) {
        this.#logger.warn(
          { inputName: pair.inputName, outputName: pair.outputName },
          'cable pair shares a device end with an earlier pair — skipped',
        )
        continue
      }
      seenPairKeys.add(cablePairKey(pair))
      for (const end of ends) seenEndNames.add(end)
      inventory.push(pair)
    }
    return inventory
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
