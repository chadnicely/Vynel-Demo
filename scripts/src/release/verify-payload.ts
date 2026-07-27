// The Phase-A gate: proves the assembled payload is complete, source-free, and
// actually boots on the staged runtime with the repo nowhere on its path.
//
//   tsx scripts/src/release/verify-payload.ts [win-x64|linux-x64|linux-arm64]
//
// Static asserts, then (win-x64 on Windows) a smoke boot: spawn the staged
// node with the bundle into a temp app-data dir, poll the port, hit a route
// that exercises migrations + DB + web UI, kill. Reports payload size and
// cold-start time — the levers doc (docs/release-plan.md risks) reads these.
//
// `--dir=<path>` verifies a payload COPIED OUTSIDE the repo — the honest form
// of the green bar (nothing on a user's machine has the repo to fall back to).

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolvePayloadTarget, type PayloadTarget } from './payload-targets.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')
const dirArg = process.argv.slice(2).find((arg) => arg.startsWith('--dir='))
const payloadDir = dirArg?.slice('--dir='.length) ?? join(repoRoot, 'apps', 'desktop', 'src-tauri', 'payload')
const backendDir = join(payloadDir, 'backend')
const SMOKE_PORT = 8996

const failures: string[] = []
function assertThat(condition: boolean, message: string): void {
  if (!condition) failures.push(message)
}

function walkFiles(directory: string, visit: (filePath: string) => void): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) walkFiles(entryPath, visit)
    else visit(entryPath)
  }
}

function directorySizeBytes(directory: string): number {
  let total = 0
  walkFiles(directory, (filePath) => {
    total += statSync(filePath).size
  })
  return total
}

function runStaticAsserts(target: PayloadTarget): void {
  const { stagedNodeName } = target
  assertThat(existsSync(join(backendDir, 'dist', 'server.mjs')), 'backend/dist/server.mjs missing')
  assertThat(
    existsSync(join(backendDir, 'dist', 'notification-listener.ps1')),
    'notification-listener.ps1 missing beside the bundle',
  )
  assertThat(existsSync(join(payloadDir, stagedNodeName)), `staged runtime ${stagedNodeName} missing`)
  assertThat(existsSync(join(payloadDir, 'web', 'index.html')), 'web/index.html missing')

  // The IP gate: no @vynel source anywhere, and no TypeScript outside
  // node_modules (third-party npm packages legitimately publish their own .ts
  // — zod, onnxruntime — which is public content, not our code).
  let typescriptFileCount = 0
  walkFiles(payloadDir, (filePath) => {
    if (filePath.includes(`${sep}node_modules${sep}`)) return
    if (filePath.endsWith('.ts') && !filePath.endsWith('.d.ts')) typescriptFileCount += 1
  })
  assertThat(typescriptFileCount === 0, `${typescriptFileCount} .ts source files leaked into the payload`)
  assertThat(
    !existsSync(join(backendDir, 'node_modules', '@vynel')),
    '@vynel packages leaked into the payload node_modules',
  )

  // Migrations travel complete — count matches the repo, journal included.
  const repoMigrationsDir = join(repoRoot, 'packages', 'db', 'src', 'migrations-sqlite')
  const payloadMigrationsDir = join(backendDir, 'assets', 'migrations-sqlite')
  const sqlCount = (dir: string): number => readdirSync(dir).filter((name) => name.endsWith('.sql')).length
  assertThat(existsSync(payloadMigrationsDir), 'assets/migrations-sqlite missing')
  if (existsSync(payloadMigrationsDir)) {
    assertThat(
      sqlCount(payloadMigrationsDir) === sqlCount(repoMigrationsDir),
      `migrations .sql count mismatch: payload ${sqlCount(payloadMigrationsDir)} vs repo ${sqlCount(repoMigrationsDir)}`,
    )
    assertThat(
      existsSync(join(payloadMigrationsDir, 'meta', '_journal.json')),
      'migrations meta/_journal.json missing (drizzle cannot run without it)',
    )
  }

  for (const contentDir of ['session-instructions', 'tool-descriptions', 'notebooks']) {
    assertThat(
      existsSync(join(backendDir, 'assets', 'instructions', contentDir)),
      `assets/instructions/${contentDir} missing`,
    )
  }

  // Native + spawned-from-disk runtime pieces.
  const nodeModulesDir = join(backendDir, 'node_modules')
  assertThat(
    existsSync(join(nodeModulesDir, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')),
    'better-sqlite3 native binary missing',
  )
  assertThat(existsSync(join(nodeModulesDir, 'sqlite-vec')), 'sqlite-vec missing')
  assertThat(existsSync(join(nodeModulesDir, 'onnxruntime-node')), 'onnxruntime-node missing')
  // The SDK spawns its native per-platform claude binary from the optional
  // dep pnpm's supportedArchitectures selected for the target.
  const sdkPlatformPackage = `claude-agent-sdk-${target.os}-${target.cpu}`
  const sdkBinaryName = target.os === 'win32' ? 'claude.exe' : 'claude'
  assertThat(
    existsSync(join(nodeModulesDir, '@anthropic-ai', sdkPlatformPackage, sdkBinaryName)),
    `@anthropic-ai/${sdkPlatformPackage}/${sdkBinaryName} missing (the SDK spawns it from disk)`,
  )
}

async function smokeBoot(stagedNodePath: string): Promise<void> {
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

  const bootStartedAt = Date.now()
  try {
    let ready = false
    while (Date.now() - bootStartedAt < 60_000) {
      if (child.exitCode !== null) break
      try {
        // Root serves the web UI in sidecar mode; /api/health may not exist —
        // any HTTP answer proves boot + migrations + gateway wiring.
        const response = await fetch(`http://127.0.0.1:${SMOKE_PORT}/`)
        if (response.status < 500) {
          ready = true
          break
        }
      } catch {
        // Not listening yet — keep polling until the 60s deadline.
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250))
    }
    const coldStartMs = Date.now() - bootStartedAt
    assertThat(ready, `payload did not answer on :${SMOKE_PORT} within 60s.\n--- output ---\n${output}`)
    if (ready) {
      const index = await fetch(`http://127.0.0.1:${SMOKE_PORT}/`)
      assertThat(index.ok, `web UI root returned ${index.status}`)
      console.log(`verify-payload: smoke boot OK — cold start ${coldStartMs}ms`)
    }
  } finally {
    child.kill()
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500))
    rmSync(appDataDir, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  const target = resolvePayloadTarget(process.argv.slice(2).find((arg) => !arg.startsWith('--')))
  if (!existsSync(payloadDir)) {
    throw new Error(`No payload at ${payloadDir} — run build-payload.ts first.`)
  }

  runStaticAsserts(target)

  const canSmoke = target.os === 'win32' && process.platform === 'win32'
  if (canSmoke && failures.length === 0) {
    await smokeBoot(join(payloadDir, target.stagedNodeName))
  } else if (!canSmoke) {
    console.log(`verify-payload: skipping smoke boot (${target.id} payload on ${process.platform}).`)
  }

  const sizeMb = Math.round(directorySizeBytes(payloadDir) / (1024 * 1024))
  console.log(`verify-payload: payload size ${sizeMb} MB`)

  if (failures.length > 0) {
    console.error(`verify-payload: FAILED\n - ${failures.join('\n - ')}`)
    process.exitCode = 1
    return
  }
  console.log('verify-payload: PASS')
}

main().catch((err) => {
  console.error('verify-payload failed:', err)
  process.exitCode = 1
})
