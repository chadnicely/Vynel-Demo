import { describe, it, expect } from 'vitest'
import {
  isWindowState,
  restoreIfMinimized,
  setWindowState,
  windowStateVerb,
  WINDOW_STATES,
  type WindowState,
} from './window-state.js'

// The Win32 command constants the script must carry — a wrong number here is a
// silent wrong action (SW_MINIMIZE where SW_RESTORE was meant), which no other
// test would catch.
const SW_MAXIMIZE = 3
const SW_MINIMIZE = 6
const SW_RESTORE = 9

function capturingRunner(result = 'True') {
  const commands: string[] = []
  return {
    commands,
    run: async (command: string) => {
      commands.push(command)
      return result
    },
  }
}

describe('isWindowState / windowStateVerb', () => {
  it('accepts exactly the three states', () => {
    expect(WINDOW_STATES).toEqual(['restored', 'maximized', 'minimized'])
    for (const state of WINDOW_STATES) expect(isWindowState(state)).toBe(true)
    expect(isWindowState('fullscreen')).toBe(false)
    expect(isWindowState(9)).toBe(false)
    expect(isWindowState(undefined)).toBe(false)
  })

  it('reads back in past tense for the tool response', () => {
    expect(windowStateVerb('restored')).toBe('restored')
    expect(windowStateVerb('maximized')).toBe('maximized')
    expect(windowStateVerb('minimized')).toBe('minimized')
  })
})

describe('restoreIfMinimized', () => {
  it('gates the ShowWindow call on IsIconic — a normal or maximized window is never touched', async () => {
    // The whole safety of folding this into ensureForeground rests on the gate:
    // without it, focusing a MAXIMIZED window would silently un-maximize it.
    const { commands, run } = capturingRunner()
    await restoreIfMinimized(1234, run)
    const command = commands[0] ?? ''
    expect(command).toContain('if ([VynelWindow]::IsIconic($h))')
    expect(command).toContain(`ShowWindow($h, ${SW_RESTORE})`)
    expect(command).toContain('Get-Process -Id 1234')
  })

  it('asks for NOT-iconic as the success condition', async () => {
    // The echo must be the verified END STATE, not "the call ran" — and for a
    // restore, success is a window that is no longer iconic.
    expect(capturingRunner().commands).toEqual([])
    const { commands, run } = capturingRunner()
    await restoreIfMinimized(1, run)
    expect(commands[0] ?? '').toContain('IsIconic($h) -eq $false')
  })

  it('reports the verified end state, not merely that the call ran', async () => {
    expect(await restoreIfMinimized(1, capturingRunner('True').run)).toBe(true)
    expect(await restoreIfMinimized(1, capturingRunner('False').run)).toBe(false)
  })

  it('degrades to false when PowerShell reports nothing (best-effort)', async () => {
    // The shared runner returns '' on any failure; a restore that cannot be
    // confirmed must read as "not restored" so the caller surfaces it honestly.
    expect(await restoreIfMinimized(1, async () => '')).toBe(false)
  })
})

describe('setWindowState', () => {
  it('sends the right Win32 command for each state, UNGATED', async () => {
    const expected: Record<WindowState, number> = {
      restored: SW_RESTORE,
      maximized: SW_MAXIMIZE,
      minimized: SW_MINIMIZE,
    }
    for (const [state, showCommand] of Object.entries(expected) as Array<[WindowState, number]>) {
      const { commands, run } = capturingRunner()
      await setWindowState(7, state, run)
      const command = commands[0] ?? ''
      expect(command).toContain(`ShowWindow($h, ${showCommand})`)
      // The explicit tool applies the state unconditionally — an IsIconic gate
      // here would make "minimize" a no-op on the visible window it targets.
      expect(command).toContain('if ($true)')
      expect(command).not.toContain('if ([VynelWindow]::IsIconic($h))')
    }
  })

  it('asks for the END STATE that matches the request — minimize is not a failure', async () => {
    // Echoing a bare `-not IsIconic` made a SUCCESSFUL minimize report false;
    // the caller then can't tell success from failure, so it reported a lie.
    const minimize = capturingRunner()
    await setWindowState(7, 'minimized', minimize.run)
    expect(minimize.commands[0] ?? '').toContain('IsIconic($h) -eq $true')

    for (const state of ['maximized', 'restored'] as WindowState[]) {
      const visible = capturingRunner()
      await setWindowState(7, state, visible.run)
      expect(visible.commands[0] ?? '').toContain('IsIconic($h) -eq $false')
    }
  })

  it('reports whether the window verifiably reached the state', async () => {
    expect(await setWindowState(7, 'minimized', capturingRunner('True').run)).toBe(true)
    expect(await setWindowState(7, 'maximized', capturingRunner('False').run)).toBe(false)
    expect(await setWindowState(7, 'maximized', async () => '')).toBe(false)
  })

  it('guards a process with no window instead of acting on a null handle', async () => {
    const { commands, run } = capturingRunner()
    await setWindowState(7, 'maximized', run)
    expect(commands[0] ?? '').toContain('$h -ne 0')
  })
})
