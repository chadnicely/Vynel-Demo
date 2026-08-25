import { createReadStream, createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import unbzip2 from 'unbzip2-stream'

const execFileAsync = promisify(execFile)

// Extract a `.tar.bz2` (or plain `.tar`) into `targetDir`. The bzip2 layer is
// decompressed IN-PROCESS (streamed, pure JS) before the system `tar` runs:
// Windows' bundled bsdtar is often built WITHOUT libbz2 and falls back to
// spawning a `bzip2` program clean machines don't have — "Can't initialize
// filter; unable to run program 'bzip2 -d'" (QC field report, 2026-08-26).
// Dev boxes masked it because Git/MSYS put a capable tar on PATH. A PLAIN tar
// is read natively by every bsdtar, so the un-tarring keeps the system `tar`
// and its Windows-safe calling shape: `cwd` + the BARE archive name (bsdtar
// reads a drive-letter path like `E:\…` as a remote `host:path`).
export async function extractArchive(archiveName: string, targetDir: string): Promise<void> {
  let tarName = archiveName
  if (archiveName.endsWith('.bz2')) {
    tarName = archiveName.slice(0, -'.bz2'.length)
    await pipeline(
      createReadStream(join(targetDir, archiveName)),
      unbzip2(),
      createWriteStream(join(targetDir, tarName)),
    )
    // The compressed original is spent; the caller's cleanup tolerates it
    // being gone already.
    await rm(join(targetDir, archiveName), { force: true })
  }
  try {
    await execFileAsync('tar', ['-xf', tarName], { cwd: targetDir })
  } finally {
    if (tarName !== archiveName) await rm(join(targetDir, tarName), { force: true })
  }
}
