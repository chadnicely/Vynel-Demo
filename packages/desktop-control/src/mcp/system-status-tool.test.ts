import { describe, it, expect } from 'vitest'
import { makeSystemStatusTool } from './system-status-tool.js'
import type { SystemSnapshot } from '../system/system-status.js'

type BuiltTool = {
  name: string
  annotations?: { readOnlyHint?: boolean }
  handler: (args: Record<string, unknown>) => Promise<{
    isError?: boolean
    content: Array<{ type: string; text?: string }>
  }>
}

const snapshot: SystemSnapshot = {
  cpuPercent: 12,
  cpuCores: 8,
  memoryUsedGb: 4,
  memoryTotalGb: 16,
  battery: null,
  disks: [],
  busiest: [],
}

const build = (read: () => Promise<SystemSnapshot>) =>
  makeSystemStatusTool({ read }) as unknown as BuiltTool

describe('system_status', () => {
  it('is declared read-only — it never changes the machine', () => {
    expect(build(async () => snapshot).annotations?.readOnlyHint).toBe(true)
  })

  it('reports the machine when the probe succeeds', async () => {
    const result = await build(async () => snapshot).handler({})
    expect(result.isError).not.toBe(true)
    expect(result.content[0]?.text).toContain('CPU: 12% of 8 cores')
  })

  it('fails honestly rather than inventing vitals', async () => {
    // A machine that cannot report its own state must not have it guessed at —
    // a plausible-looking fake reading is worse than an error, because the user
    // would act on it.
    const result = await build(async () => {
      throw new Error('WMI unavailable')
    }).handler({})
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('WMI unavailable')
    expect(result.content[0]?.text).not.toMatch(/CPU:/)
  })
})
