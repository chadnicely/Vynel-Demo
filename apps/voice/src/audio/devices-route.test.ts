import { describe, expect, it, vi } from 'vitest'
import pino from 'pino'
import type { CpalEnumeratedDevice } from './cpal.js'
import { createDevicesRoute } from './devices-route.js'

function enumerated(overrides: Partial<CpalEnumeratedDevice>): CpalEnumeratedDevice {
  return {
    name: 'Microphone (Realtek)',
    deviceId: 'id:mic',
    hostId: 'WASAPI',
    isDefaultInput: false,
    isDefaultOutput: false,
    ...overrides,
  }
}

const logger = pino({ level: 'silent' })

describe('GET /devices', () => {
  it('answers with what the daemon can bind', async () => {
    const app = createDevicesRoute({
      listDevices: () => [enumerated({ name: 'Microphone (Yeti Stereo Microphone)', isDefaultInput: true })],
      logger,
    })

    const response = await app.request('/')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      devices: [
        { name: 'Microphone (Yeti Stereo Microphone)', isDefaultInput: true, isDefaultOutput: false },
      ],
    })
  })

  it('answers with an empty list rather than 500ing the settings screen', async () => {
    const warn = vi.spyOn(logger, 'warn')
    const app = createDevicesRoute({
      listDevices: () => {
        throw new Error('no audio host')
      },
      logger,
    })

    const response = await app.request('/')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ devices: [] })
    expect(warn).toHaveBeenCalled()
  })
})
