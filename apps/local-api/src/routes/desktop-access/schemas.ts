// Zod schemas for the `desktop-access` HTTP surface. The tier enum mirrors
// `DESKTOP_ACCESS_TIERS` in `@vynel/desktop-control` (the one home of the
// tier model — this is the wire-shape projection of it).

import { z } from 'zod'
import { DESKTOP_ACCESS_TIERS } from '@vynel/desktop-control'

export const DesktopAccessParamSchema = z.object({
  appName: z.string().min(1),
})

export const DesktopAppGrantResponseSchema = z.object({
  id: z.string(),
  appName: z.string(),
  tier: z.enum(DESKTOP_ACCESS_TIERS),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const ListDesktopAccessResponseSchema = z.array(DesktopAppGrantResponseSchema)
