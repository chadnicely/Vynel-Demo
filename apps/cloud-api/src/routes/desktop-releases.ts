// The desktop updater's update-check surface — Tauri v2's dynamic-server
// protocol. The installed app polls
//   GET /releases/desktop/{{target}}/{{arch}}/{{current_version}}
// (the endpoint build-desktop.ts bakes into the release config). 200 + body
// = install this; 204 = up to date. Unauthenticated on purpose: an update
// check must work before sign-in ever happens. Thin: the fetch/cache/compare
// core lives in services/desktop-release-manifest.ts.

import { Hono } from 'hono'
import { z } from 'zod'
import { ValidationError } from '@vynel/errors'
import { DESKTOP_UPDATE_ARCHES, DESKTOP_UPDATE_TARGETS } from '@vynel/contracts/hub/desktop-release'
import type { CloudAppOptions } from '../cloud-app-options.js'
import { formatZodIssues } from '../middleware/json-validator.js'
import { SEMVER_TRIPLE_PATTERN } from '../services/desktop-release-manifest.js'

const UpdateCheckParamsSchema = z.object({
  target: z.enum(DESKTOP_UPDATE_TARGETS),
  arch: z.enum(DESKTOP_UPDATE_ARCHES),
  currentVersion: z.string().regex(SEMVER_TRIPLE_PATTERN, 'expected a plain x.y.z version'),
})

export function buildDesktopReleaseRoutes(options: CloudAppOptions) {
  return new Hono().get('/desktop/:target/:arch/:currentVersion', async (c) => {
    // safeParse, not parse — a raw ZodError would escape onError as a 500
    // instead of the hub's `{code, message}` 400 envelope.
    const params = UpdateCheckParamsSchema.safeParse(c.req.param())
    if (!params.success) throw new ValidationError(formatZodIssues(params.error))

    const update = await options.desktopReleases.resolveUpdate(params.data)
    if (update === null) return c.body(null, 204)
    return c.json(update)
  })
}
