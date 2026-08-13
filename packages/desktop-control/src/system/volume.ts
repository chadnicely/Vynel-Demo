// System volume — the loudness entry from item 11, WITHOUT the loudness
// package: its Windows impl is a bundled pre-compiled unsigned exe (the
// node-notifier objection again), so the auditable route is the vendored
// volume.ps1 beside it (CoreAudio COM via Add-Type). Kafi's cross-platform
// preference (2026-08-13) is honored at THIS seam: a darwin/linux
// implementation slots in behind `setSystemVolume` without the tool changing.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const execFileAsync = promisify(execFile)
const helperDir = dirname(fileURLToPath(import.meta.url))
const VOLUME_HELPER_PATH = join(helperDir, 'volume.ps1')
// Generous: the first call pays an Add-Type C# compile (~1s).
const VOLUME_TIMEOUT_MS = 15_000

const VOLUME_LEVEL_VARIABLE = 'VYNEL_VOLUME_LEVEL'
const VOLUME_MUTE_VARIABLE = 'VYNEL_VOLUME_MUTE'

/** What the audio device reports AFTER the change — verified, never assumed. */
export type SystemVolumeState = { level: number; muted: boolean }

export type SetSystemVolumeInput = {
  /** 0–100. Omit to leave the level alone. */
  level?: number
  /** Omit to leave mute alone. */
  mute?: boolean
}

/** The exact PowerShell invocation, separated from the spawn for tests. Args
 *  ride env vars (the launch-app lesson); an omitted arg sets no variable, and
 *  the helper leaves that half of the state untouched. */
export function buildVolumeInvocation(input: SetSystemVolumeInput): {
  args: string[]
  env: Record<string, string>
} {
  return {
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', VOLUME_HELPER_PATH],
    env: {
      ...(input.level !== undefined ? { [VOLUME_LEVEL_VARIABLE]: String(input.level) } : {}),
      ...(input.mute !== undefined ? { [VOLUME_MUTE_VARIABLE]: input.mute ? 'true' : 'false' } : {}),
    },
  }
}

/** Parse the helper's one JSON line into a verified state. Exported for tests. */
export function parseVolumeState(stdout: string): SystemVolumeState {
  const line = stdout.trim().split('\n').at(-1) ?? ''
  const parsed = JSON.parse(line) as { level?: unknown; muted?: unknown }
  if (typeof parsed.level !== 'number' || typeof parsed.muted !== 'boolean') {
    throw new Error(`volume helper returned an unexpected shape: ${line.slice(0, 120)}`)
  }
  return { level: parsed.level, muted: parsed.muted }
}

/**
 * Change (or with no fields, read) the default output device's volume, and
 * return the state the device REPORTS afterwards.
 */
export async function setSystemVolume(
  input: SetSystemVolumeInput,
  deps: { run?: (args: string[], env: Record<string, string>) => Promise<string> } = {},
): Promise<SystemVolumeState> {
  if (input.level !== undefined && (!Number.isInteger(input.level) || input.level < 0 || input.level > 100)) {
    throw new Error(`Volume level must be a whole number from 0 to 100, got ${input.level}.`)
  }
  const invocation = buildVolumeInvocation(input)
  const run =
    deps.run ??
    (async (args: string[], env: Record<string, string>): Promise<string> => {
      if (process.platform !== 'win32') {
        throw new Error('System volume control is supported on Windows only.')
      }
      const { stdout } = await execFileAsync('powershell', args, {
        windowsHide: true,
        timeout: VOLUME_TIMEOUT_MS,
        env: { ...process.env, ...invocation.env },
      })
      return stdout
    })
  return parseVolumeState(await run(invocation.args, invocation.env))
}
