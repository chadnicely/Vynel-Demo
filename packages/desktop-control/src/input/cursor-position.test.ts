import { describe, it, expect } from 'vitest'
import { parseCursorPosition, readCursorPosition } from './cursor-position.js'

describe('parseCursorPosition', () => {
  it('reads a plain position', () => {
    expect(parseCursorPosition('960,540\n')).toEqual({ x: 960, y: 540 })
  })

  it('keeps NEGATIVE coordinates — a second monitor lives there', () => {
    // A display left of or above the primary has a negative origin. Rejecting
    // these would make the pointer unreportable on exactly the multi-monitor
    // setups this tool exists for.
    expect(parseCursorPosition('-540,113')).toEqual({ x: -540, y: 113 })
    expect(parseCursorPosition('-1080,-847')).toEqual({ x: -1080, y: -847 })
  })

  it('returns null rather than a position it is unsure of', () => {
    // The model AIMS with this. A half-parsed or invented coordinate is worse
    // than none, because it would silently click somewhere.
    for (const bad of ['', '   ', 'x,y', '960', '960,', '960,540,7', 'True', '9 60,540']) {
      expect(parseCursorPosition(bad)).toBeNull()
    }
  })
})

describe('readCursorPosition', () => {
  it('reads through the injected runner', async () => {
    expect(await readCursorPosition(async () => '12,34')).toEqual({ x: 12, y: 34 })
  })

  it('degrades to null when the shell reports nothing', async () => {
    expect(await readCursorPosition(async () => '')).toBeNull()
  })

  it('asks Win32 for the position, never the input engine', async () => {
    // The load-bearing choice. nut.js's getPosition has been measured
    // disagreeing with the OS on a scaled monitor (and is what produced this
    // repo's retracted "DPI fix"), though it does not always. Win32 is the
    // independent witness either way, so a future simplification to the
    // convenient reader must fail here rather than pass quietly.
    let command = ''
    await readCursorPosition(async (sent) => {
      command = sent
      return '1,2'
    })
    expect(command).toContain('GetCursorPos')
    expect(command).toContain('user32.dll')
  })
})
