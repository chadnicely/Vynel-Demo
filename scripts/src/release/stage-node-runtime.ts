// Downloads the pinned Node runtime for a payload target, verifies it against
// nodejs.org's SHASUMS256 manifest, and stages the bare node binary at the
// payload root. Archives cache under .cache/node-runtimes/ so repeat builds
// are offline; the hash check runs on every build, cached or not. NOTE: the
// manifest's detached signature is NOT verified — the trust anchor is the
// first TLS fetch of SHASUMS256.txt (cached thereafter). Signature
// verification against Node's release key is a deferred hardening.

import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import JSZip from 'jszip'
import { PINNED_NODE_VERSION, type PayloadTarget } from './payload-targets.js'

const NODE_DIST_BASE_URL = `https://nodejs.org/dist/v${PINNED_NODE_VERSION}`

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Download failed (${response.status} ${response.statusText}): ${url}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

async function fetchExpectedSha256(archiveName: string, cacheDir: string): Promise<string> {
  const manifestPath = join(cacheDir, `SHASUMS256-v${PINNED_NODE_VERSION}.txt`)
  if (!existsSync(manifestPath)) {
    writeFileSync(manifestPath, await download(`${NODE_DIST_BASE_URL}/SHASUMS256.txt`))
  }
  const line = readFileSync(manifestPath, 'utf8')
    .split('\n')
    .find((candidate) => candidate.trim().endsWith(`  ${archiveName}`) || candidate.trim().endsWith(` ${archiveName}`))
  if (line === undefined) {
    throw new Error(`${archiveName} not listed in SHASUMS256.txt for v${PINNED_NODE_VERSION}.`)
  }
  return line.trim().split(/\s+/)[0]!
}

async function extractNodeBinary(target: PayloadTarget, archivePath: string): Promise<Buffer> {
  if (target.nodeArchiveName.endsWith('.zip')) {
    const zip = await JSZip.loadAsync(readFileSync(archivePath))
    const entry = zip.file(target.nodeBinaryInArchive)
    if (entry === null) {
      throw new Error(`${target.nodeBinaryInArchive} missing from ${target.nodeArchiveName}.`)
    }
    return entry.async('nodebuffer')
  }
  // .tar.xz — Windows 11's bsdtar decompresses xz natively; extract the one
  // file. Relative paths from the cache dir: bsdtar reads `E:\...`'s colon as
  // a remote-host separator and tries to ssh to a machine called E.
  const cacheDir = dirname(archivePath)
  const extractDirName = `extract-${target.id}`
  const extractDir = join(cacheDir, extractDirName)
  mkdirSync(extractDir, { recursive: true })
  const result = spawnSync(
    'tar',
    ['-xf', target.nodeArchiveName, '-C', extractDirName, target.nodeBinaryInArchive],
    { cwd: cacheDir },
  )
  if (result.status !== 0) {
    throw new Error(
      `tar failed extracting ${target.nodeBinaryInArchive}: ${result.stderr?.toString() ?? 'unknown error'}`,
    )
  }
  return readFileSync(join(extractDir, target.nodeBinaryInArchive))
}

export async function stageNodeRuntime(input: {
  target: PayloadTarget
  cacheDir: string
  payloadDir: string
}): Promise<string> {
  const { target, cacheDir, payloadDir } = input
  mkdirSync(cacheDir, { recursive: true })

  const archivePath = join(cacheDir, target.nodeArchiveName)
  if (!existsSync(archivePath)) {
    writeFileSync(archivePath, await download(`${NODE_DIST_BASE_URL}/${target.nodeArchiveName}`))
  }

  const expectedSha256 = await fetchExpectedSha256(target.nodeArchiveName, cacheDir)
  const actualSha256 = createHash('sha256').update(readFileSync(archivePath)).digest('hex')
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `${target.nodeArchiveName} SHA-256 mismatch — expected ${expectedSha256}, got ${actualSha256}. ` +
        'Delete .cache/node-runtimes/ and rebuild; if it persists, treat the download path as compromised.',
    )
  }

  const stagedPath = join(payloadDir, target.stagedNodeName)
  writeFileSync(stagedPath, await extractNodeBinary(target, archivePath))
  if (target.stagedNodeName === 'node') chmodSync(stagedPath, 0o755)
  return stagedPath
}
