import { describe, it, expect } from 'vitest'
import { isWindowHostProcess, readWindowIdentity } from './window-host-processes.js'

// The packaged-app (UWP) class. Windows runs every Store app's window inside one
// shared ApplicationFrameHost process, so the process name identifies the HOST,
// not the app. Measured live 2026-08-12 with both apps open:
//   "Application Frame Host" | "Settings"   | pid 8828
//   "Application Frame Host" | "Calculator" | pid 8828
// Treating that name as an identity let ONE consent cover Calculator, Settings,
// Store, Photos and Mail together.
const hostWindow = (title: string) => ({
  appName: () => 'Application Frame Host',
  title: () => title,
})

describe('isWindowHostProcess', () => {
  it('recognises the packaged-app host, casing and spacing aside', () => {
    expect(isWindowHostProcess('Application Frame Host')).toBe(true)
    expect(isWindowHostProcess('  application frame host ')).toBe(true)
  })

  it('does not mistake a real app for a host', () => {
    for (const name of ['Calculator', 'Google Chrome', 'Application Verifier', '']) {
      expect(isWindowHostProcess(name)).toBe(false)
    }
  })
})

describe('readWindowIdentity', () => {
  it('names a hosted window by its TITLE — the app, not the host', () => {
    expect(readWindowIdentity(hostWindow('Calculator'))).toBe('Calculator')
    expect(readWindowIdentity(hostWindow('Settings'))).toBe('Settings')
  })

  it('leaves an ordinary app on its own process name', () => {
    expect(readWindowIdentity({ appName: () => 'Discord', title: () => 'music | Discord' })).toBe(
      'Discord',
    )
  })

  it('refuses to name a hosted window with no title, rather than falling back to the host', () => {
    // The whole point: an unnameable window must fail closed, because the
    // alternative hands back a name spanning every packaged app.
    expect(readWindowIdentity(hostWindow('   '))).toBeNull()
    expect(readWindowIdentity({ appName: () => 'Application Frame Host' })).toBeNull()
  })

  it('survives a window that throws', () => {
    expect(
      readWindowIdentity({
        appName: () => {
          throw new Error('gone')
        },
      }),
    ).toBeNull()
  })

  it('reduces a PATH-shaped app name to its display half — measured on the packaged Notepad', () => {
    // The window source reported the full WindowsApps exe path as the app name,
    // which then rode the plan, the authorizer and the durable record verbatim.
    expect(
      readWindowIdentity({
        appName: () =>
          'C:\\Program Files\\WindowsApps\\Microsoft.WindowsNotepad_11.2606.15.0_x64__8wekyb3d8bbwe\\Notepad\\Notepad.exe',
      }),
    ).toBe('Notepad')
    expect(readWindowIdentity({ appName: () => '/usr/bin/some-app' })).toBe('some-app')
    // The .exe strip is case-insensitive — Windows paths are.
    expect(readWindowIdentity({ appName: () => 'D:\\Tools\\Editor.EXE' })).toBe('Editor')
  })

  it('leaves BARE names untouched, even exe-suffixed ones — nothing that worked changes key', () => {
    expect(readWindowIdentity({ appName: () => 'chrome.exe' })).toBe('chrome.exe')
    expect(readWindowIdentity({ appName: () => 'Discord' })).toBe('Discord')
  })

  it('falls back to the original string when a path has no usable basename', () => {
    // Trailing separator or a bare ".exe" basename — a broken path must never
    // reduce to an EMPTY identity, which would read as unnameable.
    expect(readWindowIdentity({ appName: () => 'C:\\Dir\\App\\' })).toBe('C:\\Dir\\App\\')
    expect(readWindowIdentity({ appName: () => 'C:\\Dir\\.exe' })).toBe('C:\\Dir\\.exe')
  })

  it('a host arriving as a raw exe PATH still counts as a host — no dodge via reduction', () => {
    // The consent-widening this file exists to prevent: reduced to
    // "ApplicationFrameHost", the name must hit the host rule, so the window
    // is named by its TITLE like every hosted window.
    expect(
      readWindowIdentity({
        appName: () => 'C:\\Windows\\System32\\ApplicationFrameHost.exe',
        title: () => 'Calculator',
      }),
    ).toBe('Calculator')
    expect(
      readWindowIdentity({ appName: () => 'C:\\Windows\\System32\\ApplicationFrameHost.exe' }),
    ).toBeNull()
  })
})

