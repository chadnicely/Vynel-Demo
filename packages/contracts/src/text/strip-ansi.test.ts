import { describe, it, expect } from 'vitest'
import { stripAnsi } from './strip-ansi.js'

// The strippers' shared home (three leaves used to carry a copy each). The
// escapes are written as \u001b so the source stays readable.
describe('stripAnsi', () => {
  it('drops CSI colour runs and keeps the text between them', () => {
    expect(stripAnsi(`\u001b[36mvite\u001b[0m ready in \u001b[1m312\u001b[22m ms`)).toBe('vite ready in 312 ms')
  })

  it('drops cursor/erase sequences and private-mode toggles a TUI paints with', () => {
    expect(stripAnsi(`\u001b[2K\u001b[1G\u001b[?25lbuilding\u001b[?25h`)).toBe('building')
  })

  it('drops a stray lone ESC — a chunk split mid-sequence leaves one behind', () => {
    expect(stripAnsi(`done\u001b`)).toBe('done')
  })

  it('leaves plain text alone, brackets included', () => {
    expect(stripAnsi('[warn] wrote a[0]=1 to /tmp/x')).toBe('[warn] wrote a[0]=1 to /tmp/x')
  })

  it('leaves an empty string alone', () => {
    expect(stripAnsi('')).toBe('')
  })
})
