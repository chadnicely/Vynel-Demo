import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Logger } from 'pino'
import type { CallCablePair } from './call-registry.js'

// Linux needs no driver at all: PulseAudio/PipeWire null sinks created at
// runtime ARE the virtual cables. Per pair, four pactl modules:
//   voice cable — null-sink "Vynel Call <n> Voice" (Vynel speaks into it)
//                 + remap-source "Vynel Call <n> Microphone" off its monitor
//                 (what the call app picks as mic — many apps hide monitor
//                 sources in their pickers, a remap makes a real source);
//   ears cable  — null-sink "Vynel Call <n> Speaker" (the call app's speaker)
//                 + remap-source "Vynel Call <n> Ears" off its monitor
//                 (what Vynel records).
// The Vynel-facing ends carry the SAME "Vynel Call <n> Ears/Voice" names the
// registry auto-discovers — one naming convention across OSes.
//
// The pool is created at boot and destroyed at shutdown: pulse modules are
// runtime state (they never survive a reboot), so a clean exit leaves the
// user's machine untouched. Stale modules from a crashed daemon are reaped by
// name prefix at the next boot. Per-call create/destroy needs an async
// startCall reshape — recorded as a later-improve in
// docs/module-notes/virtual-audio-driver.md. Real-box integration (do these
// names surface through cpal's Linux enumeration?) is marked there too.

const execFileAsync = promisify(execFile)

/** Injectable pactl seam — tests fake it; the real one shells out. */
export type PactlRunner = (args: readonly string[]) => Promise<{ stdout: string }>

// Bounded: a hung sound-server socket must stall neither boot nor shutdown.
export const runPactl: PactlRunner = async (args) => execFileAsync('pactl', [...args], { timeout: 5_000 })

const PULSE_NAME_PREFIX = 'vynel_call_'

export interface LinuxCallCablePool {
  readonly pairs: readonly CallCablePair[]
  /** Unloads every module the pool created. Idempotent; never throws. */
  destroy(): Promise<void>
}

interface LoadedModule {
  readonly moduleId: number
  readonly purpose: string
}

export async function createLinuxCallCablePool(
  logger: Logger,
  pairCount: number,
  pactl: PactlRunner = runPactl,
): Promise<LinuxCallCablePool> {
  const loaded: LoadedModule[] = []
  const pairs: CallCablePair[] = []

  for (let pairNumber = 1; pairNumber <= pairCount; pairNumber += 1) {
    const pairModules: LoadedModule[] = []
    try {
      for (const moduleSpec of cablePairModules(pairNumber)) {
        const moduleId = await loadModule(pactl, moduleSpec.args)
        pairModules.push({ moduleId, purpose: moduleSpec.purpose })
      }
    } catch (error) {
      // Half a cable pair is worse than none — roll this pair back (reverse:
      // remaps depend on their sinks) and stop: the failure is systemic
      // (pactl missing, module unavailable), so later pairs would fail the
      // same way. Whatever completed stays usable.
      await unloadModules(logger, pactl, [...pairModules].reverse())
      logger.warn(
        {
          pairNumber,
          failedAfter: pairModules.length,
          error: error instanceof Error ? error.message : String(error),
        },
        'linux call cable pair failed to load — call audio runs on whatever pairs completed; ' +
          'is PulseAudio/PipeWire running with pactl on PATH?',
      )
      break
    }
    loaded.push(...pairModules)
    pairs.push({
      inputName: `Vynel Call ${pairNumber} Ears`,
      outputName: `Vynel Call ${pairNumber} Voice`,
    })
  }

  if (pairs.length > 0) {
    logger.info({ pairs: pairs.length, modules: loaded.length }, 'linux null-sink call cables ready')
  }

  let destroyed = false
  return {
    pairs,
    destroy: async () => {
      if (destroyed) return
      destroyed = true
      await unloadModules(logger, pactl, [...loaded].reverse())
    },
  }
}

// Reap by name prefix, not by recorded ids: a crashed daemon took its id list
// with it, and ids get recycled by the sound server anyway.
export async function reapStaleVynelModules(logger: Logger, pactl: PactlRunner = runPactl): Promise<void> {
  let stdout: string
  try {
    stdout = (await pactl(['list', 'short', 'modules'])).stdout
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'could not list pulse modules — skipping stale vynel cable reap',
    )
    return
  }
  const staleModules: LoadedModule[] = []
  for (const line of stdout.split('\n')) {
    const [id, moduleName, moduleArguments = ''] = line.split('\t')
    if (id === undefined || moduleName === undefined) continue
    const isVynelOwned =
      moduleArguments.includes(`sink_name=${PULSE_NAME_PREFIX}`) ||
      moduleArguments.includes(`source_name=${PULSE_NAME_PREFIX}`)
    if (!isVynelOwned) continue
    const moduleId = Number(id)
    if (!Number.isInteger(moduleId)) continue
    staleModules.push({ moduleId, purpose: moduleName })
  }
  if (staleModules.length === 0) return
  // Reverse of listing order ≈ dependency order (remaps unload before their
  // master sinks) — same rule as the pool's own rollback and destroy paths.
  await unloadModules(logger, pactl, [...staleModules].reverse())
  logger.info({ reaped: staleModules.length }, 'reaped stale vynel call cable modules from a previous run')
}

interface CableModuleSpec {
  readonly purpose: string
  readonly args: readonly string[]
}

function cablePairModules(pairNumber: number): CableModuleSpec[] {
  const voiceSink = `${PULSE_NAME_PREFIX}${pairNumber}_voice`
  const speakerSink = `${PULSE_NAME_PREFIX}${pairNumber}_speaker`
  return [
    {
      purpose: 'voice sink',
      args: [
        'load-module',
        'module-null-sink',
        `sink_name=${voiceSink}`,
        `sink_properties=device.description="Vynel Call ${pairNumber} Voice"`,
      ],
    },
    {
      purpose: 'microphone remap',
      args: [
        'load-module',
        'module-remap-source',
        `master=${voiceSink}.monitor`,
        `source_name=${PULSE_NAME_PREFIX}${pairNumber}_microphone`,
        `source_properties=device.description="Vynel Call ${pairNumber} Microphone"`,
      ],
    },
    {
      purpose: 'speaker sink',
      args: [
        'load-module',
        'module-null-sink',
        `sink_name=${speakerSink}`,
        `sink_properties=device.description="Vynel Call ${pairNumber} Speaker"`,
      ],
    },
    {
      purpose: 'ears remap',
      args: [
        'load-module',
        'module-remap-source',
        `master=${speakerSink}.monitor`,
        `source_name=${PULSE_NAME_PREFIX}${pairNumber}_ears`,
        `source_properties=device.description="Vynel Call ${pairNumber} Ears"`,
      ],
    },
  ]
}

async function loadModule(pactl: PactlRunner, args: readonly string[]): Promise<number> {
  const answer = (await pactl(args)).stdout.trim()
  const moduleId = Number(answer)
  // Empty stdout would coerce to 0 — a module index pulse can legitimately own.
  if (answer.length === 0 || !Number.isInteger(moduleId)) {
    throw new Error(`pactl did not return a module id (got "${answer}")`)
  }
  return moduleId
}

// Unload failures are warnings, not errors: the module may already be gone
// (sound server restarted), and a shutdown must never wedge on cleanup.
async function unloadModules(
  logger: Logger,
  pactl: PactlRunner,
  modules: readonly LoadedModule[],
): Promise<void> {
  for (const { moduleId, purpose } of modules) {
    try {
      await pactl(['unload-module', String(moduleId)])
    } catch (error) {
      logger.warn(
        { moduleId, purpose, error: error instanceof Error ? error.message : String(error) },
        'could not unload a vynel cable module — it may already be gone',
      )
    }
  }
}
