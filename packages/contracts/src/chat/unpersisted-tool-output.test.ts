import { describe, expect, it } from 'vitest'
import {
  isUnpersistedToolOutput,
  toolOutputForStorage,
  UNPERSISTED_TOOL_OUTPUT_PLACEHOLDER,
} from './unpersisted-tool-output.js'

describe('isUnpersistedToolOutput', () => {
  it('withholds the clipboard read — its output IS whatever the user last copied', () => {
    expect(isUnpersistedToolOutput('mcp__desktop__read_clipboard')).toBe(true)
  })

  it('persists everything else, including the clipboard WRITE', () => {
    // The write's output is a character count, not the user's secrets — and the
    // text it wrote came from Claude, which the transcript already shows.
    for (const toolName of [
      'mcp__desktop__write_clipboard',
      'mcp__desktop__screenshot_app',
      'mcp__desktop__act_on_desktop',
      'Read',
      'Bash',
      '',
    ]) {
      expect(isUnpersistedToolOutput(toolName)).toBe(false)
    }
  })

  it('matches the FULL tool name — a lookalike must not opt itself out of the transcript', () => {
    expect(isUnpersistedToolOutput('read_clipboard')).toBe(false)
    expect(isUnpersistedToolOutput('mcp__evil__read_clipboard')).toBe(false)
    expect(isUnpersistedToolOutput('mcp__desktop__read_clipboard_extra')).toBe(false)
  })
})

describe('toolOutputForStorage', () => {
  it('replaces a clipboard read with the placeholder, never the plaintext', () => {
    const secret = 'hunter2-the-actual-password'
    expect(toolOutputForStorage('mcp__desktop__read_clipboard', secret)).toBe(
      UNPERSISTED_TOOL_OUTPUT_PLACEHOLDER,
    )
    expect(toolOutputForStorage('mcp__desktop__read_clipboard', secret)).not.toContain('hunter2')
  })

  it('still records that the call HAPPENED — the user must be able to see it', () => {
    // Withholding the value is not the same as hiding the action.
    expect(UNPERSISTED_TOOL_OUTPUT_PLACEHOLDER).toMatch(/clipboard/i)
    expect(UNPERSISTED_TOOL_OUTPUT_PLACEHOLDER.length).toBeGreaterThan(0)
  })

  it('passes every other tool through untouched, whatever the shape', () => {
    const output = { rows: [1, 2, 3] }
    expect(toolOutputForStorage('Read', output)).toBe(output)
    expect(toolOutputForStorage('Bash', null)).toBeNull()
    expect(toolOutputForStorage('Bash', undefined)).toBeUndefined()
  })
})
