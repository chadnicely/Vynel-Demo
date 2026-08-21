// Zod schemas for the `/display` routes — the wire shape of a widget going on
// or coming off the board.
//
// Every field that describes a widget is COMPOSED from
// `@vynel/contracts/display/display-widget-content`, never re-declared: the
// leaf validates through those same schemas, so a route that re-typed `title`
// or `content` here would be a second rulebook that drifts.

import { z } from 'zod'
import {
  DisplayWidgetContentSchema,
  DisplayWidgetKindSchema,
  DisplayWidgetSizeSchema,
  DisplayWidgetSlotSchema,
  DisplayWidgetTitleSchema,
} from '@vynel/contracts/display/display-widget-content'

/** `'global'` or a workspace id the caller owns. REQUIRED everywhere it
 *  appears: the route is user-scoped with no `:workspaceId` to fall back on,
 *  so a defaulted scope would silently put a workspace conversation's card on
 *  the global board — where the user is not looking. */
export const DisplayScopeSchema = z.string().min(1).max(64)

export const ListDisplayWidgetsQuerySchema = z.object({ scope: DisplayScopeSchema })

export const DisplayWidgetParamSchema = z.object({ widgetId: z.string().min(1).max(64) })

/** When a card takes itself off the board. ISO-8601 and in the FUTURE: the
 *  sweep drops anything already past, so a backdated stamp would make the write
 *  look like it silently failed — the card would be gone before anyone looked.
 *  Rejected at the boundary rather than in the leaf, because there is nothing
 *  sensible the leaf could do with it either. */
export const DisplayExpiresAtSchema = z
  .string()
  .datetime({ offset: true })
  .refine((iso) => new Date(iso).getTime() > Date.now(), {
    message: 'expiresAt must be in the future.',
  })

export const AddDisplayWidgetRequestSchema = z.object({
  scope: DisplayScopeSchema,
  title: DisplayWidgetTitleSchema,
  content: DisplayWidgetContentSchema,
  slot: DisplayWidgetSlotSchema.optional(),
  size: DisplayWidgetSizeSchema.optional(),
  expiresAt: DisplayExpiresAtSchema.optional(),
})

// Patch semantics: only the fields present change. `scope` is absent by
// design — a widget cannot move between boards; remove it and add it there.
// `expiresAt` can be SET or moved, never cleared: the leaf takes null for that,
// but "this card stays forever after all" has no caller yet.
export const UpdateDisplayWidgetRequestSchema = z.object({
  title: DisplayWidgetTitleSchema.optional(),
  content: DisplayWidgetContentSchema.optional(),
  slot: DisplayWidgetSlotSchema.optional(),
  size: DisplayWidgetSizeSchema.optional(),
  expiresAt: DisplayExpiresAtSchema.optional(),
})

export const ClearDisplayRequestSchema = z.object({ scope: DisplayScopeSchema })

export const DisplayWidgetResponseSchema = z.object({
  id: z.string(),
  scopeKey: z.string(),
  title: z.string(),
  kind: DisplayWidgetKindSchema,
  content: DisplayWidgetContentSchema,
  slot: DisplayWidgetSlotSchema,
  size: DisplayWidgetSizeSchema,
  sortOrder: z.number(),
  createdBySessionId: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const ListDisplayWidgetsResponseSchema = z.array(DisplayWidgetResponseSchema)

export const ClearDisplayResponseSchema = z.object({ clearedCount: z.number() })
