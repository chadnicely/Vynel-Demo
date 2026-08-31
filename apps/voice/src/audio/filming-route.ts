import { Hono } from 'hono'
import type { Logger } from 'pino'

// FILMING (Chad, 2026-08-30). While Demo Mode is armed the film counts his
// exchanges rather than reading them: any utterance is the cue. The app owns
// that state — arming is a button on a screen — so it tells the daemon here.
//
// Deliberately a plain on/off with no expiry of its own: the app turns it off
// when it disarms, and the armed flag it mirrors already expires after a
// shooting day. A daemon left filming would wake on any word in the room,
// which is why nothing but Demo Mode may set it.
export function createFilmingRoute(options: {
  setFilming: (filming: boolean) => void
  logger: Logger
}): Hono {
  const app = new Hono()
  app.post('/', async (context) => {
    const body = (await context.req.json().catch(() => null)) as { filming?: unknown } | null
    const filming = body?.filming === true
    options.setFilming(filming)
    options.logger.info({ filming }, 'filming mode')
    return context.json({ ok: true, filming })
  })
  return app
}
