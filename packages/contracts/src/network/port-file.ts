// Port-file discovery. A daemon that may bind ANY port (the desktop shell
// allocates per boot on end-user machines) writes where it actually landed;
// clients resolve: explicit env override → live port file → band default.
// Node-only module (fs/os) — browser code must never import it; the
// per-module `./*` export keeps it out of web bundles.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { VYNEL_PORT_BASE_DEFAULT } from './ports.js'

export interface PortFileRecord {
  port: number
  pid: number
}

/** The hidden user-level data dir — the `VYNEL_USER_DATA_DIR` default
 *  (`sessions/global-root-workspace.ts` resolves the same way). */
export function defaultUserDataDir(): string {
  return join(homedir(), '.vynel')
}

/** The canonical band keeps the bare name (the packaged app and the Rust
 *  shell read `engine.port`); a shifted band (a worktree) gets its own file
 *  so parallel instances never steer each other's clients. */
export function enginePortFilePath(
  portBase: number = VYNEL_PORT_BASE_DEFAULT,
  userDataDir: string = defaultUserDataDir(),
): string {
  const fileName =
    portBase === VYNEL_PORT_BASE_DEFAULT ? 'engine.port' : `engine.${portBase}.port`
  return join(userDataDir, fileName)
}

export function writePortFile(filePath: string, record: PortFileRecord): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(record))
}

export function removePortFile(filePath: string): void {
  rmSync(filePath, { force: true })
}

/** Shutdown removal that only deletes the CALLER'S advertisement — a second
 *  instance may have overwritten the file since; deleting its live record
 *  would strand that instance's clients. */
export function removePortFileIfOwn(filePath: string): void {
  let rawText: string
  try {
    rawText = readFileSync(filePath, 'utf8')
  } catch {
    return // already gone — nothing to remove
  }
  try {
    const parsed: unknown = JSON.parse(rawText)
    const pid = (parsed as Partial<PortFileRecord>).pid
    if (pid !== process.pid) return
  } catch {
    // Unparseable = not a record any live instance relies on — clean it up.
  }
  rmSync(filePath, { force: true })
}

/** The port a LIVE daemon holds, or null — missing file, unparseable
 *  content, and a dead pid (stale file from a crash) all answer null so the
 *  caller falls back to the band default. */
export function readLivePort(filePath: string): number | null {
  let rawText: string
  try {
    rawText = readFileSync(filePath, 'utf8')
  } catch {
    return null // no file = no daemon advertising a port
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    return null // garbage = treat as absent, never crash a client over it
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const { port, pid } = parsed as Partial<PortFileRecord>
  if (!Number.isInteger(port) || port === undefined || port < 1 || port > 65_535) return null
  if (!Number.isInteger(pid) || pid === undefined || pid < 1) return null
  try {
    process.kill(pid, 0)
    return port
  } catch (error) {
    // EPERM = the pid exists but belongs to someone else — alive is what
    // matters. Anything else (ESRCH) = stale file from a crash.
    return (error as NodeJS.ErrnoException).code === 'EPERM' ? port : null
  }
}

/** ONE home for the engine-URL resolution order: explicit override → live
 *  port file → the band's engine port. 127.0.0.1 literal, never localhost —
 *  the engine binds IPv4 loopback only. */
export function resolveEngineUrl(
  explicitUrl: string | undefined,
  bandEnginePort: number,
  portFilePath: string = enginePortFilePath(),
): string {
  if (explicitUrl !== undefined) return explicitUrl
  const livePort = readLivePort(portFilePath)
  return `http://127.0.0.1:${livePort ?? bandEnginePort}`
}
