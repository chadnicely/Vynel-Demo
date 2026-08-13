import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'
import { allocateSmokePort } from './smoke-boot.js'

describe('allocateSmokePort', () => {
  it('hands back a bindable ephemeral port', async () => {
    const port = await allocateSmokePort()
    expect(Number.isInteger(port)).toBe(true)
    expect(port).toBeGreaterThan(0)
    expect(port).toBeLessThanOrEqual(65_535)
    // The freed port must be immediately bindable — the contract the boot
    // relies on between allocation and the engine's own listen().
    await new Promise<void>((resolveBind, rejectBind) => {
      const server = createServer()
      server.once('error', rejectBind)
      server.listen(port, '127.0.0.1', () => server.close(() => resolveBind()))
    })
  })
})
