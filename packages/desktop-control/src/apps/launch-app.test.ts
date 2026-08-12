import { describe, it, expect } from 'vitest'
import {
  buildLaunchInvocation,
  isLaunchableAppId,
  launchApp,
  selectAppearedWindow,
} from './launch-app.js'

const chrome = { name: 'Google Chrome', appId: 'Chrome' }

/**
 * What PowerShell would actually resolve `-FilePath` to.
 *
 * This mirrors PowerShell's most dangerous habit: a variable the command
 * dereferences but the invocation never supplies resolves to the EMPTY STRING,
 * silently. That is how the original bug hid — `-Args` is only honoured by
 * `-File`, so under `-Command` the id vanished and the path became bare
 * `shell:AppsFolder\`, which is a real folder, so the launch "succeeded" and
 * opened the Applications window instead of the app. Asserting on the resolved
 * path is the only test shape that catches that class; asserting on the argument
 * array would have passed the whole time.
 */
function resolvedFilePath(appId: string): string {
  const invocation = buildLaunchInvocation(appId)
  const command = invocation.args[invocation.args.length - 1] ?? ''
  const concatenation = /\("([^"]*)"\s*\+\s*([^)]+)\)/.exec(command)
  if (concatenation === null) throw new Error(`unrecognised command shape: ${command}`)
  const literal = concatenation[1] ?? ''
  const reference = /^\$env:(\w+)$/.exec((concatenation[2] ?? '').trim())
  const substituted = reference === null ? '' : (invocation.env[reference[1] ?? ''] ?? '')
  return literal + substituted
}

describe('buildLaunchInvocation', () => {
  it('resolves to the app itself', () => {
    expect(resolvedFilePath('Docker.DockerForWindows.Settings')).toBe(
      'shell:AppsFolder\\Docker.DockerForWindows.Settings',
    )
  })

  it('never resolves to the bare Applications folder — that opens Explorer and REPORTS SUCCESS', () => {
    expect(resolvedFilePath('Chrome')).not.toBe('shell:AppsFolder\\')
  })

  it('keeps the id out of the command text so it cannot become a statement', () => {
    const invocation = buildLaunchInvocation('Some.App.Id')
    expect(invocation.args.join(' ')).not.toContain('Some.App.Id')
    expect(Object.values(invocation.env)).toContain('Some.App.Id')
  })
})

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
    // Belt-and-braces with env-var passing: the id no longer reaches
    // PowerShell's parser, but it still reaches the SHELL, and a quote or a
    // statement separator in a real Get-StartApps id is never legitimate.
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
    const { deps } = harness([[], ['chrome.exe']])
    expect(await launchApp(chrome, deps)).toEqual({ kind: 'launched', appName: 'chrome.exe' })
  })

  // Kafi, live 2026-08-12. Tray recovery means launch_app now gets called on
  // apps that ARE running, so "launch it anyway" stopped being free: Docker
  // answers a second activation with an "acquiring launcher lock" error dialog,
  // which then sits on screen looking exactly like the app.
  it('starts NOTHING when a window is already open, and says so', async () => {
    const { started, deps } = harness([['Google Chrome']])
    expect(await launchApp(chrome, deps)).toEqual({
      kind: 'already-open',
      appName: 'Google Chrome',
    })
    expect(started).toEqual([])
  })

  it('still launches a TRAY-hidden app — no window is what makes recovery legal', async () => {
    // The tray case and the already-open case are the same call; only the
    // window roster tells them apart, so this is the line that must not blur.
    const { started, deps } = harness([[], ['Docker Desktop']])
    expect(await launchApp({ name: 'Docker Desktop', appId: 'Docker.X' }, deps)).toEqual({
      kind: 'launched',
      appName: 'Docker Desktop',
    })
    expect(started).toEqual(['Docker.X'])
  })

  it('reports started-no-window at the deadline instead of hanging', async () => {
    const { deps } = harness([[]])
    expect(await launchApp(chrome, deps)).toEqual({
      kind: 'started-no-window',
      appName: 'Google Chrome',
    })
  })
})

describe('selectAppearedWindow', () => {
  it('prefers the app over a look-alike that EXTENDS its name', () => {
    // The live failure: a leftover "Docker Desktop Launcher" error dialog was
    // reported AS Docker, and the model spent the turn screenshotting an error
    // box. Order reversed here because first-hit matching is what broke.
    expect(selectAppearedWindow(['Docker Desktop Launcher', 'Docker Desktop'], 'Docker Desktop')).toBe(
      'Docker Desktop',
    )
  })

  it('takes the CLOSEST look-alike when the app itself has no window yet', () => {
    expect(
      selectAppearedWindow(['Docker Desktop Installer', 'Docker Desktop Launcher'], 'Docker Desktop'),
    ).toBe('Docker Desktop Launcher')
  })

  it('still matches a window reporting a plainer name than the Start-menu entry', () => {
    expect(selectAppearedWindow(['chrome.exe'], 'Google Chrome')).toBe('chrome.exe')
    expect(selectAppearedWindow(['Firefox'], 'Firefox Developer Edition')).toBe('Firefox')
  })

  it('ranks the plainer name ABOVE a suffixed one', () => {
    // "Firefox" is the app; "Firefox Installer" merely contains what was asked.
    expect(selectAppearedWindow(['Firefox Installer', 'Firefox'], 'Firefox Developer Edition')).toBe(
      'Firefox',
    )
  })

  it('returns null rather than guessing when nothing relates', () => {
    expect(selectAppearedWindow(['Discord', 'Slack'], 'Google Chrome')).toBeNull()
    expect(selectAppearedWindow(['Discord'], '  ')).toBeNull()
  })
})

describe('launchApp resilience', () => {
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

// Kafi hit the launcher-lock dialog TWICE, live 2026-08-12. Docker answers an
// activation it dislikes with an error dialog whose window is "Docker Desktop
// Launcher" — which contains "Docker Desktop", so ranking alone still handed it
// back as the app and the model spent the turn screenshotting an error box.
describe('a look-alike is never reported AS the app', () => {
  const docker = { name: 'Docker Desktop', appId: 'Docker.X' }

  it('reports look-alike-only rather than naming the dialog as the app', async () => {
    const { deps } = harness([[], ['Docker Desktop Launcher']])
    expect(await launchApp(docker, deps)).toEqual({
      kind: 'look-alike-only',
      appName: 'Docker Desktop',
      lookAlikeName: 'Docker Desktop Launcher',
    })
  })

  it('still returns the REAL window when it follows the look-alike', async () => {
    // A splash or installer legitimately precedes the app, so a look-alike must
    // never end the wait early.
    const { deps } = harness([[], ['Docker Desktop Launcher'], ['Docker Desktop']])
    expect(await launchApp(docker, deps)).toEqual({
      kind: 'launched',
      appName: 'Docker Desktop',
    })
  })

  it('does not let a leftover dialog count as already-open and block a launch', async () => {
    const { started, deps } = harness([['Docker Desktop Launcher'], ['Docker Desktop']])
    expect(await launchApp(docker, deps)).toEqual({ kind: 'launched', appName: 'Docker Desktop' })
    expect(started).toEqual(['Docker.X'])
  })
})
