import { describe, expect, it } from 'vitest'
import { buildContextNudge, composeContextNudgeText } from './context-nudge.js'

describe('buildContextNudge', () => {
  it('stays silent under the threshold and speaks once it is crossed', () => {
    const nudge = buildContextNudge()
    // 200k window (unknown model): 84% is quiet, 85% speaks.
    expect(nudge({ usedTokens: 168_000, model: null })).toBeNull()
    const text = nudge({ usedTokens: 170_000, model: null })
    expect(text).not.toBeNull()
    expect(text).toContain('CONTEXT CHECK (from Vynel, not the user)')
    expect(text).toContain('crossed 85% of your context')
    expect(text).toContain('170k of 200k tokens')
    expect(text).toContain('about 30k remain')
    expect(text).toContain('`checkpoint` tool')
  })

  it('does not repeat on every tool result — only at each further +5% of the window', () => {
    const nudge = buildContextNudge()
    expect(nudge({ usedTokens: 171_000, model: null })).not.toBeNull()
    // Same slice of the window: quiet.
    expect(nudge({ usedTokens: 175_000, model: null })).toBeNull()
    expect(nudge({ usedTokens: 180_000, model: null })).toBeNull()
    // +5% later: the reminder, phrased as "still going".
    const reminder = nudge({ usedTokens: 182_000, model: null })
    expect(reminder).toContain('still going')
    expect(reminder).toContain('91% of your context')
    expect(nudge({ usedTokens: 185_000, model: null })).toBeNull()
  })

  it('honours the threshold override and the checkpoint tool name', () => {
    const nudge = buildContextNudge({ threshold: 0.05, checkpointToolName: 'mcp__vynel-session__checkpoint' })
    expect(nudge({ usedTokens: 9_000, model: null })).toBeNull()
    const text = nudge({ usedTokens: 10_000, model: null })
    expect(text).toContain('crossed 5%')
    expect(text).toContain('`mcp__vynel-session__checkpoint` tool')
  })

  it('measures against the MODEL window — 1M for a 5-generation model — and quotes real headroom', () => {
    const nudge = buildContextNudge()
    // 170k is 17% of a 1M window: no nudge.
    expect(nudge({ usedTokens: 170_000, model: 'claude-opus-5' })).toBeNull()
    const text = nudge({ usedTokens: 860_000, model: 'claude-opus-5' })
    expect(text).toContain('860k of 1M tokens')
    expect(text).toContain('about 140k remain')
  })
})

describe('composeContextNudgeText', () => {
  it('rounds the percentage and formats token counts in k / M', () => {
    const text = composeContextNudgeText({
      usedTokens: 1_500_000,
      contextWindow: 2_000_000,
      threshold: 0.7,
      isReminder: false,
      checkpointToolName: 'checkpoint',
    })
    expect(text).toContain('75% used')
    expect(text).toContain('1.5M of 2M tokens')
    expect(text).toContain('about 500k remain')
  })
})
