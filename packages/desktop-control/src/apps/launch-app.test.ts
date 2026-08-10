import { describe, it, expect } from 'vitest'
import { isLaunchableAppId, launchApp } from './launch-app.js'

const chrome = { name: 'Google Chrome', appId: 'Chrome' }

function harness(windowsOverTime: string[][]) {
  let clock = 0
  let poll = 0
  const started: string[] = []
  return {
    started,
    deps: {
      startApp: async (appId: string) => {
        started.push(appId)
      },
      listWindowAppNames: () => windowsOverTime[Math.min(poll++, windowsOverTime.length - 1)] ?? [],
      now: () => clock,
      sleep: async (ms: number) => {
        clock += ms
      },
    },
  }
}

describe('isLaunchableAppId', () => {
  it('accepts real Get-StartApps id shapes', () => {
    expect(isLaunchableAppId('Microsoft.WindowsNotepad_8wekyb3d8bbwe!App')).toBe(true)
    expect(isLaunchableAppId('{6D809377-6AF0-444B-8957-A3773F02200E}\\Google\\chrome.exe')).toBe(true)
  })

  it('refuses shell metacharacters, newlines, and absurd lengths', () => {
    // Belt-and-braces with argument-array passing: an id also reaches
    // PowerShell's own parser, so a quote or a statement separator in one is
    // never legitimate.
    for (const bad of [
      'app"; Remove-Item C:\\',
      "app'; rm -rf /",
      'app`whoami`',
      'app$env:PATH',
      'app & calc',
      'app | calc',
      'app; calc',
      'app<in',
      'app>out',
      'app\nsecond-line',
      '',
      'x'.repeat(513),
    ]) {
      expect(isLaunchableAppId(bad)).toBe(false)
    }
  })
})

describe('launchApp', () => {
  it('refuses a malformed id WITHOUT starting anything', async () => {
    const { started, deps } = harness([[]])
    await expect(launchApp({ name: 'Evil', appId: 'a"; calc' }, deps)).rejects.toThrow(
      /not in the expected form/,
    )
    expect(started).toEqual([])
  })

  it('starts the app and reports the window that appeared', async () => {
    // Waiting is the point — without it the model snapshots a window that does
    // not exist yet and concludes the app failed to open.
    const { started, deps } = harness([[], [], ['Google Chrome']])
    expect(await launchApp(chrome, deps)).toEqual({ kind: 'launched', appName: 'Google Chrome' })
    expect(started).toEqual(['Chrome'])
  })

  it('matches a window named differently from the Start-menu entry', async () => {
    const { deps } = harness([['chrome.exe']])
    expect(await launchApp(chrome, deps)).toEqual({ kind: 'launched', appName: 'chrome.exe' })
  })

  it('reports started-no-window at the deadline instead of hanging', async () => {
    const { deps } = harness([[]])
    expect(await launchApp(chrome, deps)).toEqual({
      kind: 'started-no-window',
      appName: 'Google Chrome',
    })
  })

  it('keeps polling when the window source throws mid-wait', async () => {
    let poll = 0
    let clock = 0
    const result = await launchApp(chrome, {
      startApp: async () => {},
      listWindowAppNames: () => {
        poll += 1
        if (poll < 3) throw new Error('window source hiccup')
        return ['Google Chrome']
      },
      now: () => clock,
      sleep: async (ms) => {
        clock += ms
      },
    })
    expect(result).toEqual({ kind: 'launched', appName: 'Google Chrome' })
  })
})
