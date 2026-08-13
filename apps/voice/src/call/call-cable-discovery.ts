import type { CpalEnumeratedDevice } from '../audio/cpal.js'
import type { CallCablePair } from './call-registry.js'

// Devices published by Vynel's own virtual-audio driver (Windows) or the Linux
// null-sink pool are claimed as call cable pairs automatically — zero env
// config once Vynel devices exist (the env inventory stays as the fallback).
//
// The names encode pair number AND direction because cpal enumeration carries
// no capability flags: "Vynel Call <n> Ears" is the capture end Vynel records
// (the call app's speaker loops into it) and "Vynel Call <n> Voice" is the
// render end Vynel speaks into (it loops out of the call app's microphone).
// The app-facing ends ("Vynel Call <n> Microphone"/"… Speaker") are
// deliberately NOT matched — Vynel must never open the ends the call app is
// using. Naming decision recorded in docs/module-notes/virtual-audio-driver.md.
//
// Matching is prefix-shaped (word-bounded), not exact: Windows composes
// enumerated names as "<endpoint> (<adapter>)", so the real string is e.g.
// "Vynel Call 1 Ears (Vynel Virtual Audio)".

const VYNEL_CALL_END_PATTERN = /^vynel call (\d+) (ears|voice)\b/i

export interface DiscoveredCallCables {
  /** Complete pairs, ordered by pair number — names verbatim from enumeration. */
  pairs: CallCablePair[]
  /** Vynel-prefixed ends whose partner is missing (or duplicated) — never claimed. */
  orphanNames: string[]
}

interface PairEnds {
  ears?: CpalEnumeratedDevice
  voice?: CpalEnumeratedDevice
}

export function discoverVynelCallPairs(
  devices: readonly CpalEnumeratedDevice[],
): DiscoveredCallCables {
  const endsByPairNumber = new Map<number, PairEnds>()
  const orphanNames: string[] = []

  for (const device of devices) {
    const match = VYNEL_CALL_END_PATTERN.exec(device.name.trim())
    if (match === null) continue
    const pairNumber = Number(match[1])
    const direction = match[2]!.toLowerCase() as 'ears' | 'voice'
    const ends = endsByPairNumber.get(pairNumber) ?? {}
    if (ends[direction] !== undefined) {
      // A second device claiming the same end would also break exact-name
      // resolution downstream — first one wins, the extra is surfaced.
      orphanNames.push(device.name)
      continue
    }
    ends[direction] = device
    endsByPairNumber.set(pairNumber, ends)
  }

  const pairs: CallCablePair[] = []
  for (const pairNumber of [...endsByPairNumber.keys()].sort((left, right) => left - right)) {
    const ends = endsByPairNumber.get(pairNumber)!
    if (ends.voice !== undefined) {
      // Voice is the render device Vynel MUST have to speak into the call. Ears
      // is optional: present = a two-device cable (env / Linux null-sinks);
      // absent = our own Windows driver (it publishes only Voice + the
      // app-facing Microphone), so the call is HEARD via process-loopback and
      // the pair carries no capture device.
      pairs.push(
        ends.ears !== undefined
          ? { inputName: ends.ears.name, outputName: ends.voice.name }
          : { outputName: ends.voice.name },
      )
      continue
    }
    // An Ears with no Voice can't carry a call (nothing to speak into).
    if (ends.ears !== undefined) orphanNames.push(ends.ears.name)
  }
  return { pairs, orphanNames }
}
