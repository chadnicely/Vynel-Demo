import { describe, it, expect, vi } from 'vitest'
import { makeSendDesktopNotificationTool } from './send-desktop-notification-tool.js'

type BuiltTool = {
  name: string
  handler: (args: Record<string, unknown>) => Promise<{
    isError?: boolean
    content: Array<{ type: string; text?: string }>
  }>
}

describe('send_desktop_notification', () => {
  it('sends the toast and reports it also landed in the notification center', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const toolInstance = makeSendDesktopNotificationTool({ send }) as BuiltTool
    const result = await toolInstance.handler({ title: 'Done', message: 'Report sent.' })
    expect(result.isError).not.toBe(true)
    expect(send).toHaveBeenCalledWith({ title: 'Done', message: 'Report sent.' })
    expect(result.content[0]?.text).toContain('notification center')
  })

  it('surfaces the REAL platform error and redirects to chat — never claims "sent"', async () => {
    // The tool's-silence-becomes-a-platform-claim lesson: a dead per-user
    // WpnUserService must be reported as what it is.
    const send = vi.fn().mockRejectedValue(new Error('Class not registered (0x80040154)'))
    const toolInstance = makeSendDesktopNotificationTool({ send }) as BuiltTool
    const result = await toolInstance.handler({ title: 'Done' })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('0x80040154')
    expect(result.content[0]?.text).toContain('Tell the user in chat')
  })
})
