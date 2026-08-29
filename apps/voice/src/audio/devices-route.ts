import { Hono } from 'hono'
import type { Logger } from 'pino'
import type { CpalEnumeratedDevice } from './cpal.js'
import { toDaemonAudioInventory } from './device-inventory.js'

// GET /devices — the audio endpoints THIS daemon can bind.
//
// Settings → Voice builds its pickers from the browser's enumeration, which is
// a different view of the same machine: it hides names behind permission and
// names pseudo-devices of its own. The wake word binds through cpal, so this is
// the list that decides whether a saved pick actually works. Mounted on the
// daemon's loopback server, so it reaches the web app through the same
// `/voice/*` proxy every other daemon door uses.
//
// Enumeration is passed IN rather than imported, so the route carries no native
// binding and stays testable.

export interface DevicesRouteDeps {
  readonly listDevices: () => readonly CpalEnumeratedDevice[]
  readonly logger: Logger
}

export function createDevicesRoute(deps: DevicesRouteDeps): Hono {
  return new Hono().get('/', (c) => {
    try {
      return c.json({ devices: toDaemonAudioInventory(deps.listDevices()) })
    } catch (error) {
      // A host that refuses to enumerate must not 500 the settings screen —
      // an empty list reads as "the daemon offers nothing", which is true.
      deps.logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'audio devices could not be enumerated',
      )
      return c.json({ devices: [] })
    }
  })
}
