import { describe, it, expect } from 'vitest'
import {
  DESKTOP_ACCESS_TIERS,
  isDesktopAccessTier,
  maxTier,
  normalizeDesktopAppKey,
  tierAllows,
} from './desktop-access-tiers.js'

describe('tierAllows', () => {
  it('orders the tiers read < click < full', () => {
    expect(tierAllows('read', 'read')).toBe(true)
    expect(tierAllows('read', 'click')).toBe(false)
    expect(tierAllows('read', 'full')).toBe(false)
    expect(tierAllows('click', 'read')).toBe(true)
    expect(tierAllows('click', 'click')).toBe(true)
    expect(tierAllows('click', 'full')).toBe(false)
    expect(tierAllows('full', 'read')).toBe(true)
    expect(tierAllows('full', 'full')).toBe(true)
  })
})

describe('maxTier', () => {
  it('keeps the higher tier in either argument order (upserts never downgrade)', () => {
    expect(maxTier('read', 'full')).toBe('full')
    expect(maxTier('full', 'read')).toBe('full')
    expect(maxTier('click', 'click')).toBe('click')
  })
})

describe('isDesktopAccessTier', () => {
  it('accepts exactly the three tiers', () => {
    for (const tier of DESKTOP_ACCESS_TIERS) expect(isDesktopAccessTier(tier)).toBe(true)
    expect(isDesktopAccessTier('admin')).toBe(false)
    expect(isDesktopAccessTier(undefined)).toBe(false)
  })
})

describe('normalizeDesktopAppKey', () => {
  it('casefolds, trims, and strips a trailing .exe (xa11y vs node-screenshots naming)', () => {
    expect(normalizeDesktopAppKey('Discord')).toBe('discord')
    expect(normalizeDesktopAppKey('  Discord.exe ')).toBe('discord')
    expect(normalizeDesktopAppKey('DISCORD.EXE')).toBe('discord')
  })

  it('strips only a TRAILING .exe', () => {
    expect(normalizeDesktopAppKey('exe viewer')).toBe('exe viewer')
    expect(normalizeDesktopAppKey('my.exe.notes')).toBe('my.exe.notes')
  })
})

describe('normalizeDesktopAppKey — full-path app names', () => {
  it('reduces a packaged-app executable path to the bare app name', () => {
    // The window source reports packaged Windows apps as a full path whose
    // directory carries the VERSION — keying on it would mint a fresh grant
    // on every app update.
    expect(
      normalizeDesktopAppKey(
        String.raw`C:\Program Files\WindowsApps\Microsoft.WindowsNotepad_11.2605.34.0_x64__8wekyb3d8bbwe\Notepad\Notepad.exe`,
      ),
    ).toBe('notepad')
  })

  it('survives an app-update path change (same grant key before and after)', () => {
    const before = normalizeDesktopAppKey(String.raw`C:\Apps\Thing_1.0.0\Thing.exe`)
    const after = normalizeDesktopAppKey(String.raw`C:\Apps\Thing_2.5.9\Thing.exe`)
    expect(before).toBe(after)
    expect(before).toBe('thing')
  })

  it('handles forward-slash paths too', () => {
    expect(normalizeDesktopAppKey('/usr/local/bin/Discord')).toBe('discord')
  })

  it('leaves an ordinary app name (spaces included) untouched apart from casing', () => {
    expect(normalizeDesktopAppKey('Google Chrome')).toBe('google chrome')
    expect(normalizeDesktopAppKey('Zoom Meetings')).toBe('zoom meetings')
  })
})
