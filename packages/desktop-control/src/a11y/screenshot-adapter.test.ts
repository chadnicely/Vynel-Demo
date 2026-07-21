import { describe, it, expect } from 'vitest'
import { selectScreenshotWindow, screenshotApp } from './screenshot-adapter.js'

type FakeWindow = Parameters<typeof selectScreenshotWindow>[0][number]

function fakeWindow(overrides: Partial<FakeWindow>): FakeWindow {
  return {
    id: 1,
    appName: 'App',
    title: 'Window',
    isMinimized: false,
    captureImage: () => Promise.reject(new Error('not captured in tests')),
    ...overrides,
  }
}

describe('selectScreenshotWindow', () => {
  it('ranks like the a11y pid fallback: app-name match > title match, longest title wins', () => {
    const windows = [
      fakeWindow({ id: 1, appName: 'Code', title: 'a.ts - discord-bot - Visual Studio Code' }),
      fakeWindow({ id: 2, appName: 'Discord', title: '' }),
      fakeWindow({ id: 3, appName: 'Discord', title: '@user - #general - Discord' }),
    ]
    expect(selectScreenshotWindow(windows, 'discord')?.id).toBe(3)
  })

  it('returns null when nothing matches or the query is blank', () => {
    const windows = [fakeWindow({ id: 1, appName: 'Notepad', title: 'notes.txt - Notepad' })]
    expect(selectScreenshotWindow(windows, 'discord')).toBeNull()
    expect(selectScreenshotWindow(windows, '   ')).toBeNull()
  })
})

describe('screenshotApp — fail-closed guards (run before the native binary loads)', () => {
  it('rejects an empty/whitespace app name — never captures an arbitrary window', async () => {
    await expect(screenshotApp('')).rejects.toThrow(/app name .*is required/)
    await expect(screenshotApp('   ')).rejects.toThrow(/app name .*is required/)
  })
})
