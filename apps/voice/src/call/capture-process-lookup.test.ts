import { describe, expect, it } from 'vitest'
import { findCaptureProcessId, type ProcessListRunner } from './capture-process-lookup.js'

const csv = (rows: Array<[number, number, string]>): string =>
  ['"ProcessId","ParentProcessId","Name"', ...rows.map(([pid, ppid, name]) => `"${pid}","${ppid}","${name}"`)].join(
    '\r\n',
  )

const runnerOf = (stdout: string): ProcessListRunner => async () => ({ stdout })

describe('findCaptureProcessId', () => {
  it('returns the tree root — the one matching process whose parent is not the same image', async () => {
    const listing = csv([
      [100, 1, 'explorer.exe'],
      [200, 100, 'chrome.exe'], // root: parent is explorer
      [210, 200, 'chrome.exe'],
      [220, 200, 'chrome.exe'],
    ])
    expect(await findCaptureProcessId('chrome', runnerOf(listing))).toBe(200)
  })

  it('matches with or without .exe, case-insensitively', async () => {
    const listing = csv([[300, 1, 'Zoom.exe']])
    expect(await findCaptureProcessId('zoom', runnerOf(listing))).toBe(300)
    expect(await findCaptureProcessId('ZOOM.EXE', runnerOf(listing))).toBe(300)
  })

  it('several independent trees: picks the biggest one (the real browser, not a stray webview)', async () => {
    const listing = csv([
      [400, 1, 'msedge.exe'], // lone webview host
      [500, 1, 'msedge.exe'], // the browser: root of three
      [510, 500, 'msedge.exe'],
      [520, 500, 'msedge.exe'],
    ])
    expect(await findCaptureProcessId('msedge', runnerOf(listing))).toBe(500)
  })

  it('no such process → null', async () => {
    const listing = csv([[100, 1, 'explorer.exe']])
    expect(await findCaptureProcessId('chrome', runnerOf(listing))).toBeNull()
    expect(await findCaptureProcessId('   ', runnerOf(listing))).toBeNull()
  })

  it('skips malformed rows instead of failing the lookup', async () => {
    const stdout = ['"ProcessId","ParentProcessId","Name"', 'garbage line', '"nan","1","chrome.exe"', '"600","1","chrome.exe"'].join(
      '\n',
    )
    expect(await findCaptureProcessId('chrome', runnerOf(stdout))).toBe(600)
  })

  it('a parent-link cycle from a recycled pid cannot loop forever', async () => {
    const listing = csv([
      [700, 710, 'chrome.exe'],
      [710, 700, 'chrome.exe'],
    ])
    expect(await findCaptureProcessId('chrome', runnerOf(listing))).not.toBeNull()
  })
})
