import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DEFAULT_VOICE_MODEL, resolveVoiceModel, voiceModelsDir } from './voice-models.js'

// Download + extract a sherpa-onnx TTS model into the gitignored `.models/voice/`.
// Idempotent (skips if already present). Extraction shells out to `tar`, which on
// Windows 10+/macOS/Linux is bsdtar and handles `.tar.bz2` natively — no bzip2
// npm dependency. Usage: `pnpm voice:fetch-models [model]` (default: kokoro).

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
  const archiveName = `${entry.folder}.tar.bz2`
  const archivePath = join(voiceModelsDir, archiveName)

  try {
    console.log(`[voice:models] downloading "${name}" (${entry.approxSize}) …`)
    await downloadTo(entry.archiveUrl, archivePath)

    // Extract with `cwd` + the bare filename: bsdtar (Windows/macOS/Linux) reads a
    // drive-letter path like `E:\…` as a remote `host:path`, so absolute args fail.
    console.log('[voice:models] extracting …')
    await execFileAsync('tar', ['-xf', archiveName], { cwd: voiceModelsDir })
  } catch (error) {
    // A crash mid-download/extract can leave a partial folder that the idempotency
    // check above would later mistake for a complete model — wipe it so a retry is
    // clean. The archive is always removed.
    await rm(targetDir, { recursive: true, force: true })
    throw error
  } finally {
    await rm(archivePath, { force: true })
  }

  console.log(`[voice:models] ready → ${targetDir}`)
  console.log('[voice:models] next: pnpm voice:smoke')
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
