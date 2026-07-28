// The payload smoke boots verify-payload.ts runs after its static asserts:
// spawn the staged runtime on the bundle with a temp app-data dir, poll the
// port, prove the gateway answers. Native for a host-platform payload; via
// WSL for a linux payload on a Windows build machine. Each returns failure
// messages for the caller's report (empty = boot proven).

import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { PayloadTarget } from './payload-targets.js'

export const SMOKE_PORT = 8996

async function fetchProbe(): Promise<boolean> {
  try {
    // Root serves the web UI in sidecar mode; /api/health may not exist —
    // any HTTP answer proves boot + migrations + gateway wiring.
    const response = await fetch(`http://127.0.0.1:${SMOKE_PORT}/`)
    return response.status < 500
  } catch {
    return false
  }
}

async function pollUntilReady(
  isDead: () => boolean,
  deadlineMs: number,
): Promise<{ ready: boolean; elapsedMs: number }> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < deadlineMs) {
    if (isDead()) break
    if (await fetchProbe()) return { ready: true, elapsedMs: Date.now() - startedAt }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250))
  }
  return { ready: false, elapsedMs: Date.now() - startedAt }
}

export async function smokeBootNative(payloadDir: string, stagedNodePath: string): Promise<string[]> {
  const failures: string[] = []
  const backendDir = join(payloadDir, 'backend')
  const appDataDir = mkdtempSync(join(tmpdir(), 'vynel-payload-smoke-'))
  const child = spawn(stagedNodePath, [join(backendDir, 'dist', 'server.mjs')], {
    cwd: backendDir,
    env: {
      // Deliberately NOT inheriting process.env — the payload must need nothing
      // from a dev machine. Keyring/OS vars stay so native deps behave.
      SystemRoot: process.env['SystemRoot'] ?? '',
      PATH: dirname(stagedNodePath),
      PORT: String(SMOKE_PORT),
      DB_PATH: join(appDataDir, 'vynel.db'),
      VYNEL_ASSETS_DIR: join(backendDir, 'assets'),
      VYNEL_WEB_UI_DIST: join(payloadDir, 'web'),
      VYNEL_EMBEDDINGS_CACHE_DIR: join(appDataDir, 'models'),
      VYNEL_USER_DATA_DIR: join(appDataDir, 'user'),
      LOG_LEVEL: 'info',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))

  try {
    const { ready, elapsedMs } = await pollUntilReady(() => child.exitCode !== null, 60_000)
    if (!ready) {
      failures.push(`payload did not answer on :${SMOKE_PORT} within 60s.\n--- output ---\n${output}`)
      return failures
    }
    const index = await fetch(`http://127.0.0.1:${SMOKE_PORT}/`)
    if (!index.ok) failures.push(`web UI root returned ${index.status}`)
    else console.log(`verify-payload: smoke boot OK — cold start ${elapsedMs}ms`)
    return failures
  } finally {
    child.kill()
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500))
    rmSync(appDataDir, { recursive: true, force: true })
  }
}

// The linux payload boots inside a WSL distro; the payload stays on the
// Windows drive (reached via /mnt — slower over 9p, hence the longer
// deadline) while DB/models/home live on WSL-native tmpfs. The master key
// rides a file vault: a headless distro has no Secret Service, exactly the
// server-mode contract (VYNEL_MASTER_KEY_FILE).

function toWslPath(windowsPath: string): string {
  const driveLetter = windowsPath[0]?.toLowerCase()
  return `/mnt/${driveLetter}${windowsPath.slice(2).replaceAll('\\', '/')}`
}

function runInWsl(distro: string, command: string[]): { status: number | null; output: string } {
  const result = spawnSync('wsl.exe', ['-d', distro, '--', ...command], { encoding: 'utf8' })
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

export function detectWslDistro(requested: string | undefined): string | null {
  if (requested !== undefined) return requested
  const result = spawnSync('wsl.exe', ['-l', '-q'])
  if (result.status !== 0 || result.stdout === null) return null
  // wsl.exe emits UTF-16LE; decode and drop the NUL bytes a naive read leaves.
  const names = result.stdout
    .toString('utf16le')
    .split(/\r?\n/)
    .map((line) => line.replaceAll('\0', '').trim())
    .filter((name) => name !== '' && !/docker|rancher/i.test(name))
  return names[0] ?? null
}

export async function smokeBootViaWsl(
  payloadDir: string,
  target: PayloadTarget,
  distro: string,
): Promise<string[]> {
  const failures: string[] = []
  const payloadWsl = toWslPath(payloadDir)
  const backendWsl = `${payloadWsl}/backend`
  const serverWsl = `${backendWsl}/dist/server.mjs`
  const nodeWsl = `${payloadWsl}/${target.stagedNodeName}`
  const smokeBase = `/tmp/vynel-smoke-${process.pid}`

  const prepare = runInWsl(distro, ['mkdir', '-p', `${smokeBase}/home`])
  if (prepare.status !== 0) {
    failures.push(`WSL smoke prep failed in ${distro}: ${prepare.output}`)
    return failures
  }
  // Exec bits don't survive NTFS staging; /mnt drvfs default-mounts files 0777
  // so the staged `node` is runnable there without a chmod.
  const smokeEnv: Record<string, string> = {
    PATH: '/usr/local/bin:/usr/bin:/bin',
    HOME: `${smokeBase}/home`,
    PORT: String(SMOKE_PORT),
    DB_PATH: `${smokeBase}/vynel.db`,
    VYNEL_ASSETS_DIR: `${backendWsl}/assets`,
    VYNEL_WEB_UI_DIST: `${payloadWsl}/web`,
    VYNEL_EMBEDDINGS_CACHE_DIR: `${smokeBase}/models`,
    VYNEL_USER_DATA_DIR: `${smokeBase}/user`,
    VYNEL_MASTER_KEY_FILE: `${smokeBase}/master.key`,
    LOG_LEVEL: 'info',
  }
  const envPairs = Object.entries(smokeEnv).map(([key, value]) => `${key}=${value}`)
  const child = spawn(
    'wsl.exe',
    ['-d', distro, '--cd', backendWsl, '--', 'env', ...envPairs, nodeWsl, serverWsl],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let output = ''
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))

  try {
    // 9p-mounted node_modules make the first module walk slow — give the
    // cross-boundary boot five minutes rather than the native 60s.
    const { ready, elapsedMs } = await pollUntilReady(() => child.exitCode !== null, 300_000)
    if (!ready) {
      // Disambiguate "never booted" from "booted but the WSL localhost relay
      // didn't surface it on the Windows side".
      const inWslProbe = runInWsl(distro, [
        nodeWsl,
        '-e',
        `fetch('http://127.0.0.1:${SMOKE_PORT}/').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))`,
      ])
      failures.push(
        inWslProbe.status === 0
          ? `payload answers inside WSL but not through the localhost relay — check WSL networking mode.`
          : `payload did not answer on :${SMOKE_PORT} within 300s (WSL ${distro}).\n--- output ---\n${output}`,
      )
      return failures
    }
    const index = await fetch(`http://127.0.0.1:${SMOKE_PORT}/`)
    if (!index.ok) failures.push(`web UI root returned ${index.status}`)
    else console.log(`verify-payload: WSL smoke boot OK (${distro}) — cold start ${elapsedMs}ms`)
    return failures
  } finally {
    child.kill()
    runInWsl(distro, ['bash', '-c', `pkill -f '${serverWsl}' >/dev/null 2>&1; rm -rf ${smokeBase}`])
  }
}
