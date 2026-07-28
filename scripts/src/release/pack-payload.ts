// Packs a built linux payload into ONE versioned tar.gz + SHA-256 sidecar —
// the artifact the server-install provisioner uploads (Phase D2) and a
// release later serves for server-side `curl` + SHA check (Phase D5).
// Exec bits deliberately don't matter here (NTFS can't provide them): the
// provisioner chmods the staged `node` and the SDK's `claude` binary after
// extracting on the server.
//
//   tsx scripts/src/release/pack-payload.ts [linux-x64|linux-arm64]

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolvePayloadDir, resolvePayloadTarget } from './payload-targets.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')

function appVersion(): string {
  // One version stream for the product (the build-cli/build-desktop precedent).
  const config = JSON.parse(
    readFileSync(join(repoRoot, 'apps', 'desktop', 'src-tauri', 'tauri.conf.json'), 'utf8'),
  ) as { version: string }
  return config.version
}

export function packedPayloadArchivePath(targetId: string, version: string): string {
  return join(repoRoot, 'dist-payloads', `vynel-engine-${targetId}-${version}.tar.gz`)
}

async function main(): Promise<void> {
  const target = resolvePayloadTarget(process.argv.slice(2).find((arg) => !arg.startsWith('--')))
  if (target.os !== 'linux') {
    throw new Error('pack-payload packs SERVER payloads — linux targets only.')
  }
  const payloadDir = resolvePayloadDir(repoRoot, target)
  if (!existsSync(join(payloadDir, 'backend', 'dist', 'server.mjs'))) {
    throw new Error(`No payload at ${payloadDir} — run \`pnpm release:payload ${target.id}\` first.`)
  }

  const version = appVersion()
  const archivePath = packedPayloadArchivePath(target.id, version)
  // Relative paths from a cwd — bsdtar reads a drive colon as a remote host
  // (the stage-node-runtime lesson).
  const distDir = dirname(archivePath)
  console.log(`pack-payload: ${target.id} v${version} → ${archivePath}`)
  const result = spawnSync(
    'tar',
    ['-czf', basename(archivePath), '-C', target.id, '.'],
    { cwd: distDir, stdio: 'inherit' },
  )
  if (result.status !== 0) {
    throw new Error(`tar failed with exit code ${result.status ?? 'null'}.`)
  }

  const sha256 = createHash('sha256').update(readFileSync(archivePath)).digest('hex')
  writeFileSync(`${archivePath}.sha256`, `${sha256}  ${basename(archivePath)}\n`)
  const sizeMb = Math.round(statSync(archivePath).size / (1024 * 1024))
  console.log(`pack-payload: done — ${sizeMb} MB, sha256 ${sha256}`)
}

main().catch((err) => {
  console.error('pack-payload failed:', err)
  process.exitCode = 1
})
