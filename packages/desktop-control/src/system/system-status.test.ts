import { describe, it, expect } from 'vitest'
import {
  formatDuration,
  formatSystemStatus,
  pickBusiestProcesses,
  type SystemSnapshot,
} from './system-status.js'

const base: SystemSnapshot = {
  cpuPercent: 23.4,
  cpuCores: 16,
  memoryUsedGb: 12.44,
  memoryTotalGb: 31.9,
  battery: null,
  disks: [],
  busiest: [],
}

describe('formatDuration', () => {
  it('says hours and minutes the way a person would', () => {
    expect(formatDuration(135)).toBe('2h 15m')
    expect(formatDuration(45)).toBe('45m')
    expect(formatDuration(120)).toBe('2h')
  })

  it('has nothing to say about an unknown or impossible figure', () => {
    // systeminformation reports -1 / null when it cannot estimate; "-1m left"
    // would be worse than silence.
    for (const value of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatDuration(value)).toBeNull()
    }
  })
})

describe('formatSystemStatus', () => {
  it('reports load and memory with the percentage already worked out', () => {
    const text = formatSystemStatus(base)
    expect(text).toContain('CPU: 23% of 16 cores')
    expect(text).toContain('Memory: 12.4 of 31.9 GB used (39%)')
  })

  it('says a desktop has NO battery rather than reporting 0%', () => {
    // 0% reads as "flat" and is exactly the sort of thing that panics someone.
    const text = formatSystemStatus(base)
    expect(text).toMatch(/Battery: none/)
    expect(text).not.toMatch(/0%/)
  })

  it('gives time remaining only when it is actually running on battery', () => {
    const onBattery = formatSystemStatus({
      ...base,
      battery: { percent: 87.4, charging: false, minutesRemaining: 135 },
    })
    expect(onBattery).toContain('Battery: 87%, 2h 15m remaining')

    // Plugged in, a "time remaining" figure is meaningless AND alarming.
    const charging = formatSystemStatus({
      ...base,
      battery: { percent: 87.4, charging: true, minutesRemaining: 135 },
    })
    expect(charging).toContain('Battery: 87%, charging')
    expect(charging).not.toContain('2h 15m')
  })

  it('falls back gracefully when the battery cannot estimate a time', () => {
    const text = formatSystemStatus({
      ...base,
      battery: { percent: 50, charging: false, minutesRemaining: null },
    })
    expect(text).toContain('Battery: 50%, on battery')
  })

  it('reports free space, which is the number anyone actually wants', () => {
    const text = formatSystemStatus({
      ...base,
      disks: [{ mount: 'C:', freeGb: 145.2, totalGb: 500, usedPercent: 71 }],
    })
    expect(text).toContain('Disk C:: 145.2 GB free of 500 GB (71% used)')
  })

  it('names the busiest programs — the other half of "why is it slow"', () => {
    const text = formatSystemStatus({
      ...base,
      busiest: [
        { name: 'chrome.exe', cpuPercent: 18.2 },
        { name: 'node.exe', cpuPercent: 9.4 },
      ],
    })
    expect(text).toContain('Busiest right now: chrome.exe 18%, node.exe 9%')
  })

  it('stays quiet about processes when there are none to name', () => {
    expect(formatSystemStatus(base)).not.toContain('Busiest')
  })

  it('does not divide by zero when memory is unreported', () => {
    const text = formatSystemStatus({ ...base, memoryUsedGb: 0, memoryTotalGb: 0 })
    expect(text).toContain('(0%)')
    expect(text).not.toContain('NaN')
  })
})

// Caught on the FIRST live run against a real machine: the tool reported
// "Busiest right now: System Idle Process 96%". That process holds Windows'
// idle time, so a quiet machine puts it top of a CPU sort — the exact inverse
// of what the number means, and Claude would have told the user their computer
// was pinned while it was asleep.
describe('pickBusiestProcesses', () => {
  it('never reports the idle process as busy', () => {
    const picked = pickBusiestProcesses([
      { name: 'System Idle Process', cpuPercent: 96 },
      { name: 'Discord.exe', cpuPercent: 1.2 },
    ])
    expect(picked.map((p) => p.name)).toEqual(['Discord.exe'])
  })

  it('matches the idle process however it is cased or padded', () => {
    const picked = pickBusiestProcesses([{ name: '  system idle PROCESS ', cpuPercent: 99 }])
    expect(picked).toEqual([])
  })

  it('orders by CPU and keeps only the top few', () => {
    const picked = pickBusiestProcesses(
      [
        { name: 'a', cpuPercent: 1 },
        { name: 'b', cpuPercent: 9 },
        { name: 'c', cpuPercent: 5 },
      ],
      2,
    )
    expect(picked.map((p) => p.name)).toEqual(['b', 'c'])
  })
})
