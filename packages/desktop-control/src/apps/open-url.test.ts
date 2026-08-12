import { describe, it, expect, vi } from 'vitest'
import { buildOpenUrlInvocation, checkOpenableUrl, openUrl } from './open-url.js'

describe('checkOpenableUrl', () => {
  it('accepts the web-class schemes and the two meeting deep-links Kafi ruled in', () => {
    expect(checkOpenableUrl('https://example.com/page?q=1').ok).toBe(true)
    expect(checkOpenableUrl('http://example.com').ok).toBe(true)
    expect(checkOpenableUrl('mailto:chad@example.com').ok).toBe(true)
    // Item 12, settled 2026-08-13: meeting joins ride the same consent gate.
    expect(checkOpenableUrl('zoommtg://zoom.us/join?confno=123&pwd=x').ok).toBe(true)
    expect(checkOpenableUrl('msteams://teams.microsoft.com/l/meetup-join/x').ok).toBe(true)
  })

  it.each([
    // ShellExecute RUNS these — the unrestricted-execution hole the allowlist closes.
    { url: 'file:///C:/Windows/System32/calc.exe', label: 'file scheme' },
    { url: 'C:\\Windows\\System32\\calc.exe', label: 'bare local path' },
    { url: 'slack://open', label: 'a non-meeting app scheme (the allowlist stays closed)' },
    { url: 'javascript:alert(1)', label: 'javascript scheme' },
    { url: 'ms-settings:display', label: 'settings scheme' },
    // The WHATWG parser lowercases schemes before the allowlist compares —
    // pinned so a future hand-rolled parse cannot reopen the case door.
    { url: 'FILE:///C:/Windows/System32/calc.exe', label: 'uppercased file scheme' },
    { url: 'mailto:x@example.com?attach=C:%5Csecret.docx', label: 'mailto with an attachment param' },
  ])('refuses $label', ({ url }) => {
    const checked = checkOpenableUrl(url)
    expect(checked.ok).toBe(false)
  })

  it('normalizes backslash tricks into ordinary https URLs — no credential smuggle', () => {
    // `https://example.com\@evil.com` — the parser turns the backslash into a
    // path separator, so the host stays example.com and no userinfo appears.
    const checked = checkOpenableUrl('https://example.com\\@evil.com')
    expect(checked.ok).toBe(true)
    if (checked.ok) expect(checked.url.hostname).toBe('example.com')
  })

  it('refuses credentials embedded in a URL — the phishing shape', () => {
    const checked = checkOpenableUrl('https://user:secret@example.com/login')
    expect(checked.ok).toBe(false)
    if (!checked.ok) expect(checked.reason).toContain('username or password')
  })

  it('refuses a relative or non-URL string with a usable message', () => {
    const checked = checkOpenableUrl('example.com/page')
    expect(checked.ok).toBe(false)
    if (!checked.ok) expect(checked.reason).toContain('scheme included')
  })
})

describe('buildOpenUrlInvocation', () => {
  it('keeps the URL out of the command text — env var only', () => {
    // A URL is model-influenced text; interpolated under -Command it could
    // become a second PowerShell statement.
    const invocation = buildOpenUrlInvocation('https://example.com/?a=1&b=2')
    expect(invocation.args.join(' ')).not.toContain('example.com')
    expect(invocation.args.join(' ')).toContain('$env:VYNEL_OPEN_URL')
    expect(invocation.env['VYNEL_OPEN_URL']).toBe('https://example.com/?a=1&b=2')
  })
})

describe('openUrl', () => {
  it('re-checks the allowlist even when called directly — belt and braces', async () => {
    const run = vi.fn()
    await expect(openUrl('file:///C:/x.exe', { run })).rejects.toThrow('not allowed')
    expect(run).not.toHaveBeenCalled()
  })

  it('runs the invocation for an allowed URL and returns the parsed URL', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const opened = await openUrl('https://example.com/page', { run })
    expect(opened.href).toBe('https://example.com/page')
    expect(run).toHaveBeenCalledWith(
      expect.arrayContaining(['-Command']),
      expect.objectContaining({ VYNEL_OPEN_URL: 'https://example.com/page' }),
    )
  })
})
