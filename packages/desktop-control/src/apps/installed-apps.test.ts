import { describe, it, expect } from 'vitest'
import { listInstalledApps, matchInstalledApps, parseInstalledApps } from './installed-apps.js'

describe('parseInstalledApps', () => {
  it('parses the array shape', () => {
    expect(
      parseInstalledApps(
        JSON.stringify([
          { Name: 'Google Chrome', AppID: 'Chrome' },
          { Name: 'Notepad', AppID: 'Microsoft.WindowsNotepad_8wekyb3d8bbwe!App' },
        ]),
      ),
    ).toEqual([
      { name: 'Google Chrome', appId: 'Chrome' },
      { name: 'Notepad', appId: 'Microsoft.WindowsNotepad_8wekyb3d8bbwe!App' },
    ])
  })

  it('handles the SINGLE-row object shape PowerShell collapses to', () => {
    // ConvertTo-Json emits an object (not an array) for one row — the classic
    // trap that makes a one-app machine look empty.
    expect(parseInstalledApps(JSON.stringify({ Name: 'Notepad', AppID: 'notepad-id' }))).toEqual([
      { name: 'Notepad', appId: 'notepad-id' },
    ])
  })

  it('drops rows it cannot name or launch, and de-dupes by appId', () => {
    expect(
      parseInstalledApps(
        JSON.stringify([
          { Name: '  Chrome  ', AppID: '  chrome-id  ' },
          { Name: '', AppID: 'no-name' },
          { Name: 'No Id', AppID: '' },
          { Name: 'Chrome (again)', AppID: 'chrome-id' },
          { Name: 42, AppID: 'bad-type' },
        ]),
      ),
    ).toEqual([{ name: 'Chrome', appId: 'chrome-id' }])
  })

  it('is empty for empty, non-JSON, or non-object output', () => {
    for (const raw of ['', '   ', 'not json', 'null', '"a string"', '42']) {
      expect(parseInstalledApps(raw)).toEqual([])
    }
  })
})

describe('matchInstalledApps', () => {
  const apps = [
    { name: 'Google Chrome', appId: 'a' },
    { name: 'Chrome Canary', appId: 'b' },
    { name: 'Chrome', appId: 'c' },
    { name: 'Notepad', appId: 'd' },
  ]

  it('ranks exact, then prefix, then substring — shortest name breaks ties', () => {
    expect(matchInstalledApps(apps, 'chrome').map((app) => app.name)).toEqual([
      'Chrome',
      'Chrome Canary',
      'Google Chrome',
    ])
  })

  it('is case-insensitive and ignores surrounding space', () => {
    expect(matchInstalledApps(apps, '  NOTEPAD ').map((app) => app.name)).toEqual(['Notepad'])
  })

  it('is empty for no match and for a blank query', () => {
    expect(matchInstalledApps(apps, 'photoshop')).toEqual([])
    expect(matchInstalledApps(apps, '   ')).toEqual([])
  })
})

describe('listInstalledApps', () => {
  it('parses what the runner returns', async () => {
    const apps = await listInstalledApps({
      runPowerShell: async () => JSON.stringify([{ Name: 'Notepad', AppID: 'n' }]),
    })
    expect(apps).toEqual([{ name: 'Notepad', appId: 'n' }])
  })

  it('degrades to an empty roster rather than throwing', async () => {
    // The package's resilient posture: off-Windows or a PowerShell failure
    // reads as "couldn't see any installed apps", never a broken turn.
    expect(await listInstalledApps({ runPowerShell: async () => '' })).toEqual([])
  })
})
