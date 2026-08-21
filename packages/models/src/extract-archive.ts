import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// Extract a `.tar.bz2` (or any tar) into `targetDir` with the system `tar` —
// bsdtar on Windows 10+/macOS/Linux reads bzip2 natively, so no bzip2 npm dep.
// Called with `cwd` + the BARE archive name: bsdtar reads a drive-letter path
// like `E:\…` as a remote `host:path`, so an absolute argument fails on Windows.
export async function extractArchive(archiveName: string, targetDir: string): Promise<void> {
  await execFileAsync('tar', ['-xf', archiveName], { cwd: targetDir })
}
