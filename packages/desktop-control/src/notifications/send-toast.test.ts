import { describe, it, expect, vi } from 'vitest'
import {
  buildToastInvocation,
  sendDesktopToast,
  TOAST_TITLE_MAX_LENGTH,
  TOAST_MESSAGE_MAX_LENGTH,
} from './send-toast.js'

describe('buildToastInvocation', () => {
  it('runs the vendored helper by -File and carries the text in env vars only', () => {
    // The launch-app lesson: assert what is EXECUTED. Text on the command line
    // would be an injection surface; -Command would reopen the -Args trapdoor.
    const invocation = buildToastInvocation('Done', 'The report went out.')
    expect(invocation.args[invocation.args.indexOf('-File') + 1]).toMatch(/notify-toast\.ps1$/)
    // Without the policy bypass a default-policy box refuses -File outright —
    // caught on the live smoke test, so pinned here.
    expect(invocation.args).toContain('-ExecutionPolicy')
    expect(invocation.args.join(' ')).not.toContain('Done')
    expect(invocation.env).toEqual({
      VYNEL_TOAST_TITLE: 'Done',
      VYNEL_TOAST_BODY: 'The report went out.',
    })
  })
})

describe('sendDesktopToast', () => {
  it('refuses an empty title and never spawns', async () => {
    const run = vi.fn()
    await expect(sendDesktopToast({ title: '   ' }, { run })).rejects.toThrow('needs a title')
    expect(run).not.toHaveBeenCalled()
  })

  it('caps the text — a notification is a headline, not a report', async () => {
    const run = vi.fn()
    await expect(
      sendDesktopToast({ title: 'x'.repeat(TOAST_TITLE_MAX_LENGTH + 1) }, { run }),
    ).rejects.toThrow('too long')
    await expect(
      sendDesktopToast({ title: 'ok', message: 'x'.repeat(TOAST_MESSAGE_MAX_LENGTH + 1) }, { run }),
    ).rejects.toThrow('too long')
    expect(run).not.toHaveBeenCalled()
  })

  it('brands the title and passes the trimmed text through to the runner', async () => {
    // The AUMID attribution reads "Windows PowerShell" — an OS-authority
    // costume. The forced prefix says who is actually talking, so a
    // prompt-injected toast cannot pose as Windows itself.
    const run = vi.fn().mockResolvedValue(undefined)
    await sendDesktopToast({ title: '  Done  ', message: ' All good. ' }, { run })
    expect(run).toHaveBeenCalledWith(
      expect.arrayContaining(['-File']),
      expect.objectContaining({ VYNEL_TOAST_TITLE: 'Vynel — Done', VYNEL_TOAST_BODY: 'All good.' }),
    )
  })

  it('lets the platform error through untouched — 0x80040154 must reach the caller', async () => {
    const run = vi.fn().mockRejectedValue(new Error('Class not registered (0x80040154)'))
    await expect(sendDesktopToast({ title: 'Done' }, { run })).rejects.toThrow('0x80040154')
  })
})
