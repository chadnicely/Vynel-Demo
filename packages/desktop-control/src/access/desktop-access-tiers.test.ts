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
