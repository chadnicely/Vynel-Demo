import { describe, expect, it } from 'vitest'
import { buildJarvisLaunchCommand } from './jarvis-window.js'

// The spawn side is a fire-and-forget shell call (smoke-verified live); the
// invocation building is the part worth pinning per platform.

describe('buildJarvisLaunchCommand', () => {
  it('uses `start` on Windows so the browser resolves via App Paths, not PATH', () => {
    expect(buildJarvisLaunchCommand('chrome', 'http://localhost:8999/jarvis', 'win32')).toEqual({
      command: 'cmd',
      args: ['/c', 'start', '', 'chrome', '--app=http://localhost:8999/jarvis', '--window-size=420,560'],
    })
  })

  it('maps msedge to its macOS app name', () => {
    expect(buildJarvisLaunchCommand('msedge', 'http://localhost:8999/jarvis', 'darwin')).toEqual({
      command: 'open',
      args: ['-na', 'Microsoft Edge', '--args', '--app=http://localhost:8999/jarvis', '--window-size=420,560'],
    })
  })

  it('calls the browser binary directly on linux', () => {
    expect(buildJarvisLaunchCommand('chrome', 'http://localhost:8999/jarvis', 'linux')).toEqual({
      command: 'google-chrome',
      args: ['--app=http://localhost:8999/jarvis', '--window-size=420,560'],
    })
  })
})
