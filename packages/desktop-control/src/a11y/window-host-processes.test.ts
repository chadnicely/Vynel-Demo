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
})

