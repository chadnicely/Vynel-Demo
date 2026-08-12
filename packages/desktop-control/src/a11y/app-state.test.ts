import { describe, it, expect } from 'vitest'
import {
  chooseAppWindow,
  decideAppState,
  describeAppState,
  type AppWindowCandidate,
} from './app-state.js'

const window = (overrides: Partial<AppWindowCandidate> = {}): AppWindowCandidate => ({
  appName: 'Discord',
  windowTitle: '@user - Discord',
  isMinimized: false,
  isFocused: false,
  x: 100,
  y: 50,
  width: 1200,
  height: 800,
  ...overrides,
})

describe('chooseAppWindow', () => {
  it('finds the app by its name OR its window title', () => {
    expect(chooseAppWindow([window()], 'Discord')?.appName).toBe('Discord')
    // Window titles are how packaged apps and browser tabs are addressable.
    expect(chooseAppWindow([window()], '@user')?.appName).toBe('Discord')
  })

  it('prefers a VISIBLE window over a minimized one', () => {
    // An app with a main window and a minimized helper is, to the user, open.
    // Reporting "minimized" would send the model to restore what is on screen.
    const chosen = chooseAppWindow(
      [window({ isMinimized: true, windowTitle: 'helper' }), window({ windowTitle: 'main' })],
      'Discord',
    )
    expect(chosen?.windowTitle).toBe('main')
  })

  it('prefers the focused window, then the largest', () => {
    const focused = chooseAppWindow(
      [window({ windowTitle: 'big', width: 2000 }), window({ windowTitle: 'front', isFocused: true })],
      'Discord',
    )
    expect(focused?.windowTitle).toBe('front')

    const largest = chooseAppWindow(
      [window({ windowTitle: 'tooltip', width: 100, height: 40 }), window({ windowTitle: 'main' })],
      'Discord',
    )
    expect(largest?.windowTitle).toBe('main')
  })

  it('returns null rather than guessing when nothing matches', () => {
    expect(chooseAppWindow([window()], 'Photoshop')).toBeNull()
  })
})

describe('decideAppState', () => {
  it('tells TRAY apart from not-running — they need opposite recoveries', () => {
    expect(decideAppState(null, 'Docker', true)).toEqual({ kind: 'tray', query: 'Docker' })
    expect(decideAppState(null, 'Docker', false)).toEqual({
      kind: 'not-running',
      query: 'Docker',
    })
  })

  it('reports minimized without any geometry — it has no on-screen position', () => {
    const state = decideAppState(window({ isMinimized: true }), 'Discord', true)
    expect(state.kind).toBe('minimized')
    expect(state).not.toHaveProperty('x')
  })

  it('says whether a visible window is actually the one in front', () => {
    const behind = decideAppState(window(), 'Discord', true)
    expect(behind).toMatchObject({ kind: 'open', foreground: false, width: 1200 })
    const front = decideAppState(window({ isFocused: true }), 'Discord', true)
    expect(front).toMatchObject({ kind: 'open', foreground: true })
  })
})

describe('describeAppState', () => {
  it('warns that a screenshot of a minimized app will RESTORE it', () => {
    // The whole reason get_app exists: the model should know that before it
    // happens, not discover it from the screenshot afterwards.
    const text = describeAppState(decideAppState(window({ isMinimized: true }), 'Discord', true))
    expect(text).toMatch(/MINIMIZED/)
    expect(text).toMatch(/screenshot_app will restore it/)
    expect(text).toMatch(/changes what is on their screen/)
  })

  it('points a tray app at launch_app, not at a window that does not exist', () => {
    const text = describeAppState(decideAppState(null, 'Docker Desktop', true))
    expect(text).toMatch(/system tray/)
    expect(text).toMatch(/launch_app/)
  })

  it('says plainly when an open window is buried behind another', () => {
    const text = describeAppState(decideAppState(window(), 'Discord', true))
    expect(text).toMatch(/NOT in front/)
  })
})
