// The Phase-C gate: proves the @vynel/cli artifact is source-free and works.
//
//   tsx scripts/src/release/verify-cli.ts
//
// Asserts on the packed tarball (what npm would actually publish), then runs
// the real programs: --help offline, one live CLI command, and an MCP
// initialize handshake over stdio — both against the daemon on
// VYNEL_API_URL (default: the installed app on :18892). Requires the daemon
// to be running; says so actionably when it is not.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')
const publishDir = join(repoRoot, 'apps', 'cli', 'dist-npm')
// The spawned CLI/MCP children read the same env var — probe and programs
// must agree on which daemon is under test.
const apiUrl = process.env['VYNEL_API_URL'] ?? 'http://localhost:18892'

const failures: string[] = []
function assertThat(condition: boolean, message: string): void {
  if (!condition) failures.push(message)
}

function packedTarballFiles(): string[] {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: publishDir,
    shell: true,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`npm pack --dry-run failed:\n${result.stderr}`)
  }
  // npm may prefix notices; the JSON array starts at the first bracket.
  const raw = result.stdout.slice(result.stdout.indexOf('['))
  const packed = JSON.parse(raw) as [{ files: { path: string }[]; size: number }]
  return packed[0].files.map((file) => file.path)
}

function runNode(args: string[], input?: string): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, args, {
    cwd: publishDir,
    encoding: 'utf8',
    ...(input !== undefined ? { input } : {}),
    timeout: 30_000,
  })
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status }
}

async function verifyMcpHandshake(): Promise<void> {
  // Speak real MCP over stdio: initialize, then tools/list — the exact calls
  // Claude Code makes on `claude mcp add vynel -- npx -y @vynel/cli mcp`.
  const child = spawn(process.execPath, [join(publishDir, 'bin', 'vynel.mjs'), 'mcp'], {
    cwd: publishDir,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let output = ''
  let errorOutput = ''
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => (errorOutput += chunk.toString()))
  // A server dying at boot must surface as the actionable assert below, not
  // as an unlistened EPIPE crash that skips the kill/cleanup path.
  child.on('error', (error) => (errorOutput += `\nspawn error: ${error.message}`))
  child.stdin.on('error', (error) => (errorOutput += `\nstdin error: ${error.message}`))
  const send = (message: object): boolean => child.stdin.write(`${JSON.stringify(message)}\n`)
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'verify-cli', version: '0.0.0' },
    },
  })
  send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })

  const deadline = Date.now() + 20_000
  let toolCount: number | undefined
  while (Date.now() < deadline && toolCount === undefined) {
    for (const line of output.split('\n')) {
      if (!line.trim().startsWith('{')) continue
      try {
        const message = JSON.parse(line) as { id?: number; result?: { tools?: unknown[] } }
        if (message.id === 2 && Array.isArray(message.result?.tools)) {
          toolCount = message.result.tools.length
        }
      } catch {
        // partial line — keep polling
      }
    }
    if (toolCount === undefined) await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
  }
  child.kill()
  assertThat(
    toolCount !== undefined && toolCount > 0,
    `MCP handshake: no tools/list result within 20s (got ${toolCount ?? 'nothing'})` +
      (errorOutput.trim().length > 0 ? `\n--- server stderr ---\n${errorOutput.slice(0, 500)}` : ''),
  )
  if (toolCount !== undefined) console.log(`verify-cli: MCP handshake OK — ${toolCount} tools listed`)
}

async function main(): Promise<void> {
  if (!existsSync(join(publishDir, 'package.json'))) {
    throw new Error(`No artifact at ${publishDir} — run build-cli.ts first.`)
  }

  // 1. The tarball is exactly the generated artifact — no source, no config.
  const files = packedTarballFiles()
  assertThat(files.length > 0, 'npm pack listed no files')
  for (const file of files) {
    assertThat(!file.endsWith('.ts'), `TypeScript source leaked into the tarball: ${file}`)
  }
  for (const expected of ['bin/vynel.mjs', 'dist/cli.mjs', 'dist/mcp-server.mjs', 'package.json', 'README.md']) {
    assertThat(files.includes(expected), `tarball missing ${expected}`)
  }
  const manifest = readFileSync(join(publishDir, 'package.json'), 'utf8')
  assertThat(!manifest.includes('workspace:'), 'workspace: range leaked into the published manifest')
  assertThat(!manifest.includes('"dependencies"'), 'published manifest must have zero dependencies (all bundled)')

  // 2. Offline: --help resolves without a daemon.
  const help = runNode([join(publishDir, 'bin', 'vynel.mjs'), '--help'])
  assertThat(help.status === 0 && help.stdout.includes('knowledge'), '--help failed or missing command groups')

  // 3. Live, against the running daemon.
  let daemonUp = false
  try {
    daemonUp = (await fetch(`${apiUrl}/api/health`).catch(() => fetch(`${apiUrl}/`))).status < 500
  } catch {
    daemonUp = false
  }
  if (!daemonUp) {
    throw new Error(`No daemon answering on ${apiUrl} — open the installed Vynel app, then re-run.`)
  }
  // `schedules mine` needs no flags — a pure cross-scope read that still
  // round-trips SDK → gateway → route.
  const live = runNode([join(publishDir, 'bin', 'vynel.mjs'), 'schedules', 'mine'])
  assertThat(
    live.status === 0 && live.stdout.trim().startsWith('['),
    `live CLI command failed (exit ${live.status}): ${live.stderr.slice(0, 300)}`,
  )
  if (live.status === 0) console.log('verify-cli: live CLI command OK (schedules mine)')
  await verifyMcpHandshake()

  if (failures.length > 0) {
    console.error(`verify-cli: FAILED\n - ${failures.join('\n - ')}`)
    process.exitCode = 1
    return
  }
  console.log('verify-cli: PASS')
}

main().catch((err) => {
  console.error('verify-cli failed:', err)
  process.exitCode = 1
})
