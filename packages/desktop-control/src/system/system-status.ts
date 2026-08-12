// The machine's own vital signs — CPU, memory, battery, disks, and what is
// actually busy.
//
// ONE tool rather than four, because the questions a non-technical person asks
// are not "what is my CPU load": they are "why is my computer slow", "is my
// battery about to die", "am I out of space". Each of those is answered by two
// or three of these numbers together, so splitting them would just make the
// model call four tools and stitch them itself.
//
// READ-ONLY, so it needs no plan and raises no overlay — the same rule the rest
// of the looking tools follow.
//
// The shaping is a PURE function over a plain snapshot, so every formatting
// decision here is testable without touching the real machine (the `readWindow`
// / `pickTopmostWindowAt` precedent in this package). Only `readSystemStatus`
// talks to `systeminformation`, and it is lazy-loaded so importing this module
// costs nothing.

/** The machine's vitals, already normalised into the units we report in. */
export type SystemSnapshot = {
  cpuPercent: number
  cpuCores: number
  memoryUsedGb: number
  memoryTotalGb: number
  /** Null when the machine has no battery (a desktop) — not zero, which would
   *  read as "flat" and is the sort of thing that panics someone. */
  battery: { percent: number; charging: boolean; minutesRemaining: number | null } | null
  disks: Array<{ mount: string; freeGb: number; totalGb: number; usedPercent: number }>
  /** Busiest processes by CPU, already truncated by the reader. */
  busiest: Array<{ name: string; cpuPercent: number }>
}

const round = (value: number, places = 0): number => {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/** "2h 15m" / "45m" / null. Minutes alone are hard to act on once they run to
 *  hundreds — "260 minutes left" makes nobody picture four hours. */
export function formatDuration(minutes: number | null): string | null {
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) return null
  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes % 60)
  if (hours === 0) return `${rest}m`
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/**
 * The snapshot as a person would say it.
 *
 * Deliberately prose-shaped rather than JSON: every consumer is a language
 * model that will paraphrase it to a human anyway, and the numbers that matter
 * (a disk at 96%, a battery at 8% and not charging) should be legible without
 * anyone computing a percentage first.
 */
export function formatSystemStatus(snapshot: SystemSnapshot): string {
  const lines: string[] = []
  lines.push(`CPU: ${round(snapshot.cpuPercent)}% of ${snapshot.cpuCores} cores`)
  const memoryPercent =
    snapshot.memoryTotalGb > 0 ? (snapshot.memoryUsedGb / snapshot.memoryTotalGb) * 100 : 0
  lines.push(
    `Memory: ${round(snapshot.memoryUsedGb, 1)} of ${round(snapshot.memoryTotalGb, 1)} GB used ` +
      `(${round(memoryPercent)}%)`,
  )

  if (snapshot.battery === null) {
    lines.push('Battery: none (this machine runs on mains power)')
  } else {
    const remaining = formatDuration(snapshot.battery.minutesRemaining)
    const state = snapshot.battery.charging
      ? 'charging'
      : // Only worth saying when it is NOT charging — a time-remaining figure
        // while plugged in is both meaningless and alarming.
        (remaining ?? 'on battery')
    lines.push(
      `Battery: ${round(snapshot.battery.percent)}%, ${state}` +
        (!snapshot.battery.charging && remaining !== null ? ' remaining' : ''),
    )
  }

  for (const disk of snapshot.disks) {
    // `use` comes straight from systeminformation, which computes it as
    // (size-free)/size — NaN on a zero-size volume (an empty card reader, an
    // unmounted share). Memory already had this guard and a test; disks did not.
    const usedPercent = Number.isFinite(disk.usedPercent) ? disk.usedPercent : 0
    lines.push(
      `Disk ${disk.mount}: ${round(disk.freeGb, 1)} GB free of ${round(disk.totalGb, 1)} GB ` +
        `(${round(usedPercent)}% used)`,
    )
  }

  if (snapshot.busiest.length > 0) {
    const busiest = snapshot.busiest
      .map((process) => `${process.name} ${round(process.cpuPercent)}%`)
      .join(', ')
    lines.push(`Busiest right now: ${busiest}`)
  }
  return lines.join('\n')
}

/** How many processes to name. Enough to explain a slow machine, few enough
 *  that the answer stays readable — and it is a list of what the user is
 *  running, so there is no reason to enumerate all of it. */
export const BUSIEST_PROCESS_COUNT = 5

/**
 * Processes that are not WORK, whatever the CPU column says.
 *
 * Windows' "System Idle Process" holds the machine's idle time, so on a quiet
 * machine it sits at ~96% and sorting by CPU puts it firmly at the top. Caught
 * on the first live run: the tool cheerfully reported "Busiest right now:
 * System Idle Process 96%", which inverts the truth — that number means the
 * machine is doing NOTHING. Reporting it would have had Claude tell someone
 * their computer was pinned when it was asleep.
 */
const NOT_REAL_WORK = new Set(['system idle process'])

/** Busiest first, with the idle accounting removed. Pure, and separate from the
 *  reader so the exclusion is testable without a real process list. */
export function pickBusiestProcesses(
  processes: Array<{ name: string; cpuPercent: number }>,
  limit = BUSIEST_PROCESS_COUNT,
): Array<{ name: string; cpuPercent: number }> {
  return [...processes]
    .filter((process) => !NOT_REAL_WORK.has(process.name.trim().toLowerCase()))
    .sort((a, b) => b.cpuPercent - a.cpuPercent)
    .slice(0, limit)
}

type SystemInformationModule = {
  currentLoad(): Promise<{ currentLoad: number }>
  cpu(): Promise<{ cores: number }>
  mem(): Promise<{ total: number; active: number }>
  battery(): Promise<{
    hasBattery: boolean
    percent: number
    isCharging: boolean
    timeRemaining: number | null
  }>
  fsSize(): Promise<Array<{ mount: string; size: number; available: number; use: number }>>
  processes(): Promise<{ list: Array<{ name: string; cpu: number }> }>
}

const BYTES_PER_GB = 1024 ** 3

/** Read the machine's vitals. Lazy import so merely importing this module — in
 *  a test, or on a machine where a probe would be pointless — costs nothing. */
export async function readSystemStatus(): Promise<SystemSnapshot> {
  const systemInformation = (await import('systeminformation')) as unknown as SystemInformationModule
  // In parallel: these are independent OS probes, and `processes()` alone can
  // take a beat. Serially this would be the slowest tool in the package.
  const [load, cpu, memory, battery, disks, processes] = await Promise.all([
    systemInformation.currentLoad(),
    systemInformation.cpu(),
    systemInformation.mem(),
    systemInformation.battery(),
    systemInformation.fsSize(),
    systemInformation.processes(),
  ])
  return {
    cpuPercent: load.currentLoad,
    cpuCores: cpu.cores,
    // `active` rather than `used`: on Windows `used` counts cache the OS will
    // hand back on demand, which reads as "nearly out of memory" on a machine
    // that is perfectly happy.
    memoryUsedGb: memory.active / BYTES_PER_GB,
    memoryTotalGb: memory.total / BYTES_PER_GB,
    battery: battery.hasBattery
      ? {
          percent: battery.percent,
          charging: battery.isCharging,
          minutesRemaining: battery.timeRemaining,
        }
      : null,
    // Fullest first: with several drives, "am I running out of space" is about
    // whichever one is nearly full, and burying it under four healthy ones
    // makes the model summarise the wrong drive.
    disks: disks
      .map((disk) => ({
        mount: disk.mount,
        freeGb: disk.available / BYTES_PER_GB,
        totalGb: disk.size / BYTES_PER_GB,
        usedPercent: disk.use,
      }))
      .sort((a, b) => b.usedPercent - a.usedPercent),
    busiest: pickBusiestProcesses(
      processes.list.map((process) => ({ name: process.name, cpuPercent: process.cpu })),
    ),
  }
}
