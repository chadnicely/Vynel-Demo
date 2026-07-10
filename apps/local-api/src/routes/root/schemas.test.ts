import { describe, expect, it } from 'vitest'
import { StartGlobalRootTurnRequestSchema } from './schemas.js'

const pngAttachment = {
  filename: 'shot.png',
  mimeType: 'image/png',
  base64Data: Buffer.from('bytes').toString('base64'),
}

describe('StartGlobalRootTurnRequestSchema', () => {
  it('accepts an attachment-only turn (empty text)', () => {
    const parsed = StartGlobalRootTurnRequestSchema.safeParse({
      userMessageText: '',
      attachedImages: [pngAttachment],
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects a turn with neither text nor attachments', () => {
    const parsed = StartGlobalRootTurnRequestSchema.safeParse({
      userMessageText: '   ',
    })
    expect(parsed.success).toBe(false)
  })

  it('accepts a document attachment (widened allowlist)', () => {
    const parsed = StartGlobalRootTurnRequestSchema.safeParse({
      userMessageText: 'summarize this',
      attachedImages: [
        { ...pngAttachment, filename: 'report.pdf', mimeType: 'application/pdf' },
      ],
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects an executable mime type', () => {
    const parsed = StartGlobalRootTurnRequestSchema.safeParse({
      userMessageText: 'run this',
      attachedImages: [
        { ...pngAttachment, filename: 'setup.exe', mimeType: 'application/x-msdownload' },
      ],
    })
    expect(parsed.success).toBe(false)
  })
})
