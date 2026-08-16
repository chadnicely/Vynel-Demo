import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// The conductor knows WHICH APP hosts a call ("the Meet tab in Chrome"), never
// a pid — this is the name→pid seam behind POST /calls' captureProcessName.
// Multi-process apps (Chrome, Edge, Zoom) render audio from a child process,
// so the useful pid is a process TREE's root: include-tree loopback rooted
// there covers the audio child wherever it sits. When several independent
// trees share the image name (two browser profiles, a stray webview), the
// call app is in the big one — most processes of that image hang off it.

const execFileAsync = promisify(execFile)

/** Injectable process-listing seam — tests fake it; the real one shells out. */
export type ProcessListRunner = () => Promise<{ stdout: string }>

// The command is a fixed string — the image name NEVER rides into the shell
// (matching happens on the parsed rows), so there is nothing to sanitize.
// Bounded: a wedged WMI service must not stall a call start.
export const runProcessList: ProcessListRunner = async () => {
  if (process.platform !== 'win32') {
    throw new Error('captureProcessName is Windows-only (process-loopback ears) — pass capturePid or omit both')
  }
  return execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Csv -NoTypeInformation',
    ],
    { timeout: 5_000, windowsHide: true },
  )
}

interface ProcessRow {
  readonly pid: number
  readonly parentPid: number
  readonly name: string
}

/** The root pid of the largest process tree whose image matches `imageName`
 *  ("chrome" and "Chrome.exe" both match chrome.exe), or null when no such
 *  process runs. */
export async function findCaptureProcessId(
  imageName: string,
  listProcesses: ProcessListRunner = runProcessList,
): Promise<number | null> {
  const wanted = normalizeImageName(imageName)
  if (wanted === '') return null
  const rows = parseProcessCsv((await listProcesses()).stdout)
  const matches = rows.filter((row) => normalizeImageName(row.name) === wanted)
  if (matches.length === 0) return null

  const byPid = new Map(matches.map((row) => [row.pid, row]))
  const rootOf = (row: ProcessRow): number => {
    let current = row
    const visited = new Set<number>([current.pid])
    // A recycled pid can make the parent links loop — the visited set breaks it.
    while (byPid.has(current.parentPid) && !visited.has(current.parentPid)) {
      current = byPid.get(current.parentPid)!
      visited.add(current.pid)
    }
    return current.pid
  }

  const treeSizes = new Map<number, number>()
  for (const row of matches) {
    const root = rootOf(row)
    treeSizes.set(root, (treeSizes.get(root) ?? 0) + 1)
  }
  let best: { root: number; size: number } | null = null
  for (const [root, size] of treeSizes) {
    // Deterministic on ties: the lower pid.
    if (best === null || size > best.size || (size === best.size && root < best.root)) {
      best = { root, size }
    }
  }
  return best === null ? null : best.root
}

function normalizeImageName(name: string): string {
  const lower = name.trim().toLowerCase()
  return lower.endsWith('.exe') ? lower.slice(0, -'.exe'.length) : lower
}

// ConvertTo-Csv emits `"ProcessId","ParentProcessId","Name"` then one quoted
// row per process. Anything that does not parse as such a row is skipped —
// a partial listing beats a failed call start.
function parseProcessCsv(stdout: string): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) continue
    const cells = trimmed.slice(1, -1).split('","')
    if (cells.length !== 3) continue
    const pid = Number(cells[0])
    const parentPid = Number(cells[1])
    const name = cells[2] ?? ''
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(parentPid) || name === '') continue
    rows.push({ pid, parentPid, name })
  }
  return rows
}
