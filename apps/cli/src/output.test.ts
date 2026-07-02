import { describe, expect, it } from 'vitest'
import { SdkError } from '@vynel/sdk'
import { formatError } from './output.js'

describe('formatError', () => {
  it('formats an SdkError with its status + envelope message', () => {
    const err = new SdkError(new Response(null, { status: 404 }), {
      code: 'not_found',
      message: 'Workspace not found.',
    })
    expect(formatError(err)).toEqual({ message: 'Error 404: Workspace not found.', exitCode: 1 })
  })

  it('formats a generic Error', () => {
    expect(formatError(new Error('boom'))).toEqual({ message: 'Error: boom', exitCode: 1 })
  })

  it('formats a non-Error thrown value', () => {
    expect(formatError('weird')).toEqual({ message: 'Error: weird', exitCode: 1 })
  })
})
