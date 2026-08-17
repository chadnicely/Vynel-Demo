// The model-id SHAPE check — the only membership rule left now that the
// roster is discovered, so it is the one boundary that can reject a model the
// engine genuinely serves.

import { describe, expect, it } from 'vitest'
import { CHAT_MODEL_ID_PATTERN, ChatModelIdSchema } from './chat-models.js'

describe('CHAT_MODEL_ID_PATTERN — context-variant ids', () => {
  // Live-verified 2026-08-17: the CLI reports Opus as `claude-opus-5[1m]`.
  // Rejecting it here meant the picker offered Opus and the turn 400'd.
  it('accepts the engine’s 1M-window variant (choosing it must not 400)', () => {
    expect(CHAT_MODEL_ID_PATTERN.test('claude-opus-5[1m]')).toBe(true)
    expect(CHAT_MODEL_ID_PATTERN.test('claude-fable-5[1m]')).toBe(true)
    expect(ChatModelIdSchema.safeParse('claude-opus-5[1m]').success).toBe(true)
  })

  it('still accepts plain and date-suffixed ids', () => {
    expect(CHAT_MODEL_ID_PATTERN.test('claude-opus-5')).toBe(true)
    expect(CHAT_MODEL_ID_PATTERN.test('claude-haiku-4-5-20251001')).toBe(true)
  })

  it('still refuses anything that is not a claude id, brackets included', () => {
    expect(CHAT_MODEL_ID_PATTERN.test('gpt-4o')).toBe(false)
    expect(CHAT_MODEL_ID_PATTERN.test('claude-opus-5[1m')).toBe(false)
    expect(CHAT_MODEL_ID_PATTERN.test('claude-opus-5[../etc]')).toBe(false)
    expect(CHAT_MODEL_ID_PATTERN.test('claude-opus-5[1m][x]')).toBe(false)
    expect(ChatModelIdSchema.safeParse('claude-opus-5[../etc]').success).toBe(false)
  })
})
