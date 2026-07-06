import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DEFAULT_VOICE_MODEL, resolveVoiceModel, voiceModelsDir } from './voice-models.js'

// Download a sherpa-onnx model into the gitignored `.models/voice/`. Handles both
// `.tar.bz2` archives (extracted with `tar`) and single files (e.g. silero_vad.onnx).
// Idempotent (skips if present). Extraction shells out to `tar`, which on Windows
// 10+/macOS/Linux is bsdtar and handles `.tar.bz2` natively — no bzip2 npm dep.
// Usage: `pnpm voice:fetch-models [model]` (default: kokoro).

const execFileAsync = promisify(execFile)

async function main(): Promise<void> {
  const name = process.argv[2] ?? DEFAULT_VOICE_MODEL
  const entry = resolveVoiceModel(name)
  const targetDir = join(voiceModelsDir, entry.folder)

  if (existsSync(targetDir)) {
    console.log(`[voice:models] "${name}" already present at ${targetDir} — nothing to do.`)
    return
  }

  await mkdir(voiceModelsDir, { recursive: true })
  console.log(`[voice:models] downloading "${name}" (${entry.approxSize}) …`)

  try {
    if (entry.download.format === 'archive') {
      await fetchArchive(entry.download.url, entry.folder)
    } else {
      await fetchFile(entry.download.url, targetDir)
    }
  } catch (error) {
    // A crash mid-fetch can leave a partial folder that the idempotency check
    // would later mistake for complete — wipe it so a retry is clean.
    await rm(targetDir, { recursive: true, force: true })
    throw error
  }

  console.log(`[voice:models] ready → ${targetDir}`)
}

async function fetchArchive(url: string, folder: string): Promise<void> {
  const archiveName = `${folder}.tar.bz2`
  const archivePath = join(voiceModelsDir, archiveName)
  try {
    await downloadTo(url, archivePath)
    // Extract with `cwd` + the bare filename: bsdtar (Windows/macOS/Linux) reads a
    // drive-letter path like `E:\…` as a remote `host:path`, so absolute args fail.
    console.log('[voice:models] extracting …')
    await execFileAsync('tar', ['-xf', archiveName], { cwd: voiceModelsDir })
  } finally {
    await rm(archivePath, { force: true })
  }
}

async function fetchFile(url: string, targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true })
  const filename = url.split('/').pop() ?? 'model.onnx'
  await downloadTo(url, join(targetDir, filename))
}

async function downloadTo(url: string, destPath: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok || response.body === null) {
    throw new Error(`download failed (${response.status} ${response.statusText}) for ${url}`)
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destPath))
}

main().catch((error: unknown) => {
  console.error(`[voice:models] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
