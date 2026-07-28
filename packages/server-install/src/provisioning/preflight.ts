// The one probe command a provisioning run executes first, and the pure
// parser/validator of its output. v1 constraint (release-plan risk #4):
// x64/arm64 glibc distros with systemd — anything else fails HERE, with a
// message that names the gap, before a single byte is uploaded.

import { ValidationError } from '@vynel/errors'

export const PREFLIGHT_COMMAND = [
  'echo "arch=$(uname -m)"',
  'echo "libc=$(ldd --version 2>&1 | head -n 1)"',
  'test -d /run/systemd/system && echo "systemd=yes" || echo "systemd=no"',
  'command -v tar >/dev/null 2>&1 && echo "tar=yes" || echo "tar=no"',
  'echo "home=$HOME"',
].join('; ')

// Only what later steps consume — the systemd/tar checks throw on failure
// rather than reporting a flag nobody reads.
export interface PreflightReport {
  arch: 'x64' | 'arm64'
  home: string
}

function readLine(stdout: string, key: string): string | null {
  const match = stdout.split('\n').find((line) => line.startsWith(`${key}=`))
  return match?.slice(key.length + 1).trim() ?? null
}

export function parsePreflightReport(stdout: string): PreflightReport {
  const rawArch = readLine(stdout, 'arch')
  const arch = rawArch === 'x86_64' ? 'x64' : rawArch === 'aarch64' ? 'arm64' : null
  if (arch === null) {
    throw new ValidationError(
      `This server's CPU (${rawArch ?? 'unknown'}) isn't supported — Vynel's engine runs on x86_64 and aarch64 Linux.`,
    )
  }
  const libcLine = readLine(stdout, 'libc') ?? ''
  if (/musl/i.test(libcLine) || !/glibc|gnu libc|GLIBC/i.test(libcLine)) {
    throw new ValidationError(
      'This server uses a C library Vynel cannot run on yet (musl/Alpine is not supported) — use a glibc distro like Debian or Ubuntu.',
    )
  }
  if (readLine(stdout, 'systemd') !== 'yes') {
    throw new ValidationError(
      "This server doesn't run systemd, which Vynel needs to keep the engine running — use a systemd distro like Debian or Ubuntu.",
    )
  }
  if (readLine(stdout, 'tar') !== 'yes') {
    throw new ValidationError("The server has no `tar` — install it (e.g. `apt install tar`) and retry.")
  }
  const home = readLine(stdout, 'home')
  if (home === null || !home.startsWith('/')) {
    throw new ValidationError("Could not resolve the server user's home directory.")
  }
  return { arch, home }
}
