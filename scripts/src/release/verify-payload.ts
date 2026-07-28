// The Phase-A gate: proves the assembled payload is complete, source-free, and
// actually boots on the staged runtime with the repo nowhere on its path.
//
//   tsx scripts/src/release/verify-payload.ts [win-x64|linux-x64|linux-arm64]
//
// Static asserts, then a smoke boot (smoke-boot.ts): win-x64 natively on
// Windows, linux targets inside WSL (`--wsl=<distro>` to pick one). Reports
// payload size and cold-start time — the levers doc (docs/release-plan.md
// risks) reads these.
//
// `--dir=<path>` verifies a payload COPIED OUTSIDE the repo — the honest form
// of the green bar (nothing on a user's machine has the repo to fall back to).

import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectedNativeBinaryFormat, readNativeBinaryFormat } from './native-binary-format.js'
import { resolvePayloadDir, resolvePayloadTarget, type PayloadTarget } from './payload-targets.js'
import { detectWslDistro, smokeBootNative, smokeBootViaWsl } from './smoke-boot.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')

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

function runStaticAsserts(payloadDir: string, target: PayloadTarget): void {
  const backendDir = join(payloadDir, 'backend')
  const { stagedNodeName } = target
  assertThat(existsSync(join(backendDir, 'dist', 'server.mjs')), 'backend/dist/server.mjs missing')
  if (target.os === 'win32') {
    assertThat(
      existsSync(join(backendDir, 'dist', 'notification-listener.ps1')),
      'notification-listener.ps1 missing beside the bundle',
    )
  } else {
    assertThat(
      !existsSync(join(backendDir, 'dist', 'notification-listener.ps1')),
      'windows-only notification-listener.ps1 leaked into a linux payload',
    )
  }
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
  // The prune step must keep exactly what the Node runtime resolves — this
  // target's onnx binary and the node-condition entries of the web/transformers
  // packages (their browser bundles are deliberately gone).
  assertThat(
    existsSync(join(nodeModulesDir, 'onnxruntime-node', 'bin', 'napi-v3', target.os, target.cpu)),
    `onnxruntime-node binary for ${target.os}/${target.cpu} missing (over-pruned?)`,
  )
  assertThat(
    existsSync(join(nodeModulesDir, 'onnxruntime-web', 'dist', 'ort.node.min.mjs')),
    'onnxruntime-web ort.node.min.mjs missing (over-pruned?)',
  )
  assertThat(
    existsSync(join(nodeModulesDir, '@huggingface', 'transformers', 'dist', 'transformers.node.mjs')),
    'transformers.node.mjs missing (over-pruned?)',
  )
  // The SDK spawns its native per-platform claude binary from the optional
  // dep pnpm's supportedArchitectures selected for the target.
  const sdkPlatformPackage = `claude-agent-sdk-${target.os}-${target.cpu}`
  const sdkBinaryName = target.os === 'win32' ? 'claude.exe' : 'claude'
  const sdkBinaryPath = join(nodeModulesDir, '@anthropic-ai', sdkPlatformPackage, sdkBinaryName)
  assertThat(
    existsSync(sdkBinaryPath),
    `@anthropic-ai/${sdkPlatformPackage}/${sdkBinaryName} missing (the SDK spawns it from disk)`,
  )

  runBinaryFormatAsserts(payloadDir, target, sdkBinaryPath)
}

// A cross-built payload's sharpest failure mode: an install script compiled
// for the HOST, so a win32 addon sits in a linux tree. Existence checks pass;
// the magic bytes don't lie.
function runBinaryFormatAsserts(payloadDir: string, target: PayloadTarget, sdkBinaryPath: string): void {
  const expected = expectedNativeBinaryFormat(target)
  const describe = (filePath: string): string =>
    `${filePath.slice(payloadDir.length + 1)} is ${readNativeBinaryFormat(filePath)}, expected ${expected}`

  const stagedNodePath = join(payloadDir, target.stagedNodeName)
  if (existsSync(stagedNodePath)) {
    assertThat(readNativeBinaryFormat(stagedNodePath) === expected, describe(stagedNodePath))
  }
  if (existsSync(sdkBinaryPath)) {
    assertThat(readNativeBinaryFormat(sdkBinaryPath) === expected, describe(sdkBinaryPath))
  }
  walkFiles(join(payloadDir, 'backend', 'node_modules'), (filePath) => {
    if (!filePath.endsWith('.node')) return
    if (readNativeBinaryFormat(filePath) !== expected) failures.push(describe(filePath))
  })
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const target = resolvePayloadTarget(args.find((arg) => !arg.startsWith('--')))
  const dirArg = args.find((arg) => arg.startsWith('--dir='))
  const payloadDir = dirArg?.slice('--dir='.length) ?? resolvePayloadDir(repoRoot, target)
  if (!existsSync(payloadDir)) {
    throw new Error(`No payload at ${payloadDir} — run build-payload.ts first.`)
  }

  runStaticAsserts(payloadDir, target)

  if (failures.length === 0 && target.os === 'win32' && process.platform === 'win32') {
    failures.push(...(await smokeBootNative(payloadDir, join(payloadDir, target.stagedNodeName))))
  } else if (failures.length === 0 && target.os === 'linux' && process.platform === 'win32') {
    const distro = detectWslDistro(args.find((arg) => arg.startsWith('--wsl='))?.slice('--wsl='.length))
    if (distro === null) {
      console.log('verify-payload: skipping smoke boot (no usable WSL distro found — pass --wsl=<name>).')
    } else {
      failures.push(...(await smokeBootViaWsl(payloadDir, target, distro)))
    }
  } else if (failures.length === 0) {
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
