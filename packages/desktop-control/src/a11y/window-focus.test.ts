import { describe, it, expect } from 'vitest'
import {
  parseBooleanResult,
  parseForegroundPid,
  ensureForeground,
  type PowerShellRunner,
} from './window-focus.js'

describe('parseBooleanResult', () => {
  it('parses PowerShell boolean echoes across casings and line endings', () => {
    expect(parseBooleanResult('True\r\n')).toBe(true)
    expect(parseBooleanResult('true')).toBe(true)
    expect(parseBooleanResult('False\r\n')).toBe(false)
  })

  it('is false on garbage or empty output (a failed runner returns "")', () => {
    expect(parseBooleanResult('')).toBe(false)
    expect(parseBooleanResult('Exception calling AppActivate')).toBe(false)
  })

  it('reads the LAST non-empty line (Add-Type noise may precede the echo)', () => {
    expect(parseBooleanResult('WARNING: something\nTrue\n')).toBe(true)
  })
})

describe('parseForegroundPid', () => {
  it('parses a pid echo', () => {
    expect(parseForegroundPid('9624\r\n')).toBe(9624)
  })

  it('is null on zero, garbage, or empty output', () => {
    expect(parseForegroundPid('0')).toBeNull()
    expect(parseForegroundPid('')).toBeNull()
    expect(parseForegroundPid('not-a-pid')).toBeNull()
    expect(parseForegroundPid('-5')).toBeNull()
  })
})

// Drive `ensureForeground` with a scripted runner: commands are classified by
// content (activate / foreground-pid probe / force), no PowerShell involved.
function scriptedRunner(script: {
  activate?: string
  foregroundPids: string[]
  force?: string
  onForce?: () => void
}): { run: PowerShellRunner; forceCalls: () => number } {
  let probeIndex = 0
  let forceCalls = 0
  const run: PowerShellRunner = (command) => {
    if (command.includes('GetForegroundWindow')) {
      const value = script.foregroundPids[Math.min(probeIndex, script.foregroundPids.length - 1)]
      probeIndex += 1
      return Promise.resolve(value ?? '')
    }
    if (command.includes('SetForegroundWindow')) {
      forceCalls += 1
      script.onForce?.()
      return Promise.resolve(script.force ?? 'False')
    }
    return Promise.resolve(script.activate ?? 'True')
  }
  return { run, forceCalls: () => forceCalls }
}

describe('ensureForeground', () => {
  it('returns true without the force retry when activation verifiably took', async () => {
    const { run, forceCalls } = scriptedRunner({ activate: 'True', foregroundPids: ['42'] })
    await expect(ensureForeground(42, run)).resolves.toBe(true)
    expect(forceCalls()).toBe(0)
  })

  it('retries ONCE with the force path when verification fails, then re-verifies', async () => {
    // First probe: some other app holds the foreground; after the force, ours does.
    const { run, forceCalls } = scriptedRunner({
      activate: 'False',
      foregroundPids: ['999', '42'],
      force: 'True',
    })
    await expect(ensureForeground(42, run)).resolves.toBe(true)
    expect(forceCalls()).toBe(1)
  })

  it('reports a KNOWN failure (false) when even the force retry cannot take focus', async () => {
    const { run, forceCalls } = scriptedRunner({
      activate: 'False',
      foregroundPids: ['999', '999'],
      force: 'False',
    })
    await expect(ensureForeground(42, run)).resolves.toBe(false)
    expect(forceCalls()).toBe(1)
  })
})
