import { describe, expect, it } from 'vitest'
import { formatCliErrorDetail } from './format-cli-error-detail.js'

describe('formatCliErrorDetail', () => {
  it('keeps the last three lines, joined', () => {
    expect(formatCliErrorDetail('usage noise\nline2\nreason a\nreason b\nreason c')).toBe(
      'reason a reason b reason c',
    )
  })

  it('caps the detail at 400 characters', () => {
    expect(formatCliErrorDetail('x'.repeat(1000))).toHaveLength(400)
  })

  it('answers empty for missing or blank stderr', () => {
    expect(formatCliErrorDetail(undefined)).toBe('')
    expect(formatCliErrorDetail('   \n  ')).toBe('')
  })
})
