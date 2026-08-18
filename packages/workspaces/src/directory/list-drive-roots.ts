// The drive/volume roots the filesystem browser can jump to, dressed the way
// Windows Explorer's "This PC" shows them: a volume label ("WORKSPACE (E:)"),
// what kind of drive it is, and free/total space for the capacity bar.
//
// Windows: every mounted letter A–Z is probed in parallel; free/total come from
// `fs.statfs` (pure Node, always fresh); labels + kinds come from ONE cached
// PowerShell `Win32_LogicalDisk` read — Node has no volume-label API, and the
// spawn costs ~0.5 s, so the result is memoized stale-while-revalidate: the
// first listing waits once, later ones read the cache and refresh it in the
// background. POSIX: the single root — everything else is reachable by
// navigating.

import { execFile } from 'node:child_process'
import { access, statfs } from 'node:fs/promises'
import { platform } from 'node:os'
import { promisify } from 'node:util'

export type DriveKind = 'fixed' | 'removable' | 'network' | 'optical' | 'unknown'

export type DriveRoot = {
  /** Absolute root path — the drive root on Windows, `/` on POSIX. */
  path: string
  /** The volume label, or null when the volume has none (the UI shows "Local Disk"). */
  label: string | null
  kind: DriveKind
  /** Bytes available to the user, or null when the volume can't be measured (an empty card reader). */
  freeBytes: number | null
  totalBytes: number | null
}

/** Structural logger (pino call shape) — the core layer never depends on `@vynel/logger`. */
export type DriveRootsLogger = {
  warn: (payload: object, message: string) => void
}

export type WindowsVolume = { label: string | null; kind: DriveKind }

export async function listDriveRoots(logger?: DriveRootsLogger): Promise<DriveRoot[]> {
  if (platform() !== 'win32') {
    return [await describeDrive('/', { label: 'Root', kind: 'fixed' })]
  }
  const [mountedRoots, volumes] = await Promise.all([
    probeMountedWindowsRoots(),
    readWindowsVolumes(logger),
  ])
  return Promise.all(
    mountedRoots.map((root) => {
      const volume = volumes.get(root.slice(0, 2).toUpperCase())
      return describeDrive(root, volume ?? { label: null, kind: 'unknown' })
    }),
  )
}

async function describeDrive(root: string, volume: WindowsVolume): Promise<DriveRoot> {
  const space = await readSpace(root)
  return { path: root, label: volume.label, kind: volume.kind, ...space }
}

async function readSpace(root: string): Promise<Pick<DriveRoot, 'freeBytes' | 'totalBytes'>> {
  try {
    const stats = await statfs(root)
    return { freeBytes: stats.bavail * stats.bsize, totalBytes: stats.blocks * stats.bsize }
  } catch {
    // A mounted-but-empty removable slot (card reader) has no measurable
    // space — the drive still lists, the capacity bar just stays blank.
    return { freeBytes: null, totalBytes: null }
  }
}

async function probeMountedWindowsRoots(): Promise<string[]> {
  const candidates = Array.from({ length: 26 }, (_, i) => `${String.fromCharCode(65 + i)}:\\`)
  const probed = await Promise.all(
    candidates.map(async (root) => {
      try {
        await access(root)
        return root
      } catch {
        return null
      }
    }),
  )
  return probed.filter((root): root is string => root !== null)
}

// ── Windows volume labels + kinds ────────────────────────────────────────────

const WINDOWS_DRIVE_KIND_BY_TYPE: Record<number, DriveKind> = {
  2: 'removable',
  3: 'fixed',
  4: 'network',
  5: 'optical',
}

/** Parse `Win32_LogicalDisk … | ConvertTo-Json -Compress` output into a map by
 *  device id (`C:`). ConvertTo-Json unwraps a single-element array to a bare
 *  object, an empty VolumeName means "no label", unknown DriveTypes are `unknown`. */
export function parseWindowsVolumes(stdout: string): Map<string, WindowsVolume> {
  const volumes = new Map<string, WindowsVolume>()
  const trimmed = stdout.trim()
  if (trimmed.length === 0) return volumes
  const parsed: unknown = JSON.parse(trimmed)
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    const { DeviceID, VolumeName, DriveType } = row as Record<string, unknown>
    if (typeof DeviceID !== 'string') continue
    volumes.set(DeviceID.toUpperCase(), {
      label: typeof VolumeName === 'string' && VolumeName.length > 0 ? VolumeName : null,
      kind:
        (typeof DriveType === 'number' ? WINDOWS_DRIVE_KIND_BY_TYPE[DriveType] : undefined) ??
        'unknown',
    })
  }
  return volumes
}

// Memoized stale-while-revalidate: a failed read is cached too (as empty), so a
// broken PowerShell doesn't re-spawn on every listing.
type VolumeCache = { readAt: number; volumes: Map<string, WindowsVolume> }
const VOLUME_CACHE_TTL_MS = 5 * 60 * 1000
let volumeCache: VolumeCache | null = null
let volumeRefresh: Promise<Map<string, WindowsVolume>> | null = null

async function readWindowsVolumes(logger?: DriveRootsLogger): Promise<Map<string, WindowsVolume>> {
  const now = Date.now()
  if (volumeCache && now - volumeCache.readAt < VOLUME_CACHE_TTL_MS) return volumeCache.volumes
  const refresh = (volumeRefresh ??= queryWindowsVolumes(logger).finally(() => {
    volumeRefresh = null
  }))
  // Stale cache: hand it back now, let the refresh land for the next caller.
  if (volumeCache) return volumeCache.volumes
  return refresh
}

// Windows PowerShell 5.1 writes redirected output in the OEM code page — force
// UTF-8 so a label like "Données" survives the pipe.
const VOLUME_QUERY =
  '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ' +
  'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,DriveType | ConvertTo-Json -Compress'

async function queryWindowsVolumes(logger?: DriveRootsLogger): Promise<Map<string, WindowsVolume>> {
  let volumes = new Map<string, WindowsVolume>()
  try {
    const { stdout } = await promisify(execFile)(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', VOLUME_QUERY],
      { windowsHide: true, timeout: 5000 },
    )
    volumes = parseWindowsVolumes(stdout)
  } catch (error) {
    // Labels are decoration — the browser still works with bare letters, so a
    // failed read degrades (and is cached) rather than failing the listing.
    logger?.warn(
      {
        module: 'workspaces.directory',
        error: error instanceof Error ? error.message : String(error),
      },
      'Could not read Windows volume labels; drives will show as bare letters.',
    )
  }
  volumeCache = { readAt: Date.now(), volumes }
  return volumes
}
