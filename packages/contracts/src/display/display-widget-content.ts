// What a Display widget can CONTAIN — the ONE definition shared by the leaf
// (persist + validate), the routes/tools (the boundary Claude writes through)
// and the renderers. Four kinds ship in P2; raw `html` is deliberately absent
// until the CSP work lands (`docs/module-notes/display-research.md` §3), so
// every kind here is data a component draws, never markup a browser executes.
//
// Contracts ships values as well as types (the VERIFIED_SKILL_CATALOG /
// ask-questions precedent), so the validator lives here too — one home, no
// drift between what the tool accepts and what the leaf stores.

import { z } from 'zod'

export const DISPLAY_WIDGET_KINDS = ['markdown', 'table', 'metric', 'chart'] as const
export type DisplayWidgetKind = (typeof DISPLAY_WIDGET_KINDS)[number]

// The named regions of the board, in reading order — the array order IS the
// presentation order (the leaf sorts by it; `DisplayView.vue` fills each slot).
export const DISPLAY_WIDGET_SLOTS = ['left', 'stage', 'right', 'dock'] as const
export type DisplayWidgetSlot = (typeof DISPLAY_WIDGET_SLOTS)[number]

export const DISPLAY_WIDGET_SIZES = ['sm', 'md', 'lg'] as const
export type DisplayWidgetSize = (typeof DISPLAY_WIDGET_SIZES)[number]

export const DISPLAY_METRIC_TONES = ['default', 'attention', 'live', 'muted'] as const
export type DisplayMetricTone = (typeof DISPLAY_METRIC_TONES)[number]

export const DISPLAY_CHART_TYPES = ['bar', 'line', 'donut'] as const
export type DisplayChartType = (typeof DISPLAY_CHART_TYPES)[number]

/** Serialized-content ceiling. A widget is a glance, not a document — and the
 *  live frame carries the whole thing over the WebSocket on every upsert. */
export const DISPLAY_WIDGET_CONTENT_MAX_BYTES = 32_768
export const DISPLAY_TITLE_MAX_LENGTH = 80
/** The board holds twelve; a thirteenth evicts the oldest (never an error). */
export const DISPLAY_MAX_WIDGETS_PER_SCOPE = 12

export const DISPLAY_TABLE_MAX_COLUMNS = 12
export const DISPLAY_TABLE_MAX_ROWS = 200
// Four series = the four validated `--chart-1..4` tokens; a fifth would have
// no accessible colour to draw with.
export const DISPLAY_CHART_MAX_SERIES = 4
export const DISPLAY_CHART_MAX_POINTS_PER_SERIES = 60

export const DisplayWidgetKindSchema = z.enum(DISPLAY_WIDGET_KINDS)
export const DisplayWidgetSlotSchema = z.enum(DISPLAY_WIDGET_SLOTS)
export const DisplayWidgetSizeSchema = z.enum(DISPLAY_WIDGET_SIZES)
export const DisplayWidgetTitleSchema = z.string().trim().min(1).max(DISPLAY_TITLE_MAX_LENGTH)

const CellSchema = z.string().max(2_000)

export const MarkdownWidgetContentSchema = z.object({
  kind: z.literal('markdown'),
  // Rendered through markdown-it + DOMPurify; the byte cap is the real limit.
  body: z.string().min(1).max(DISPLAY_WIDGET_CONTENT_MAX_BYTES),
})

export const TableWidgetContentSchema = z.object({
  kind: z.literal('table'),
  columns: z.array(z.string().min(1).max(120)).min(1).max(DISPLAY_TABLE_MAX_COLUMNS),
  rows: z.array(z.array(CellSchema)).max(DISPLAY_TABLE_MAX_ROWS),
  caption: z.string().min(1).max(200).optional(),
})

export const MetricWidgetContentSchema = z.object({
  kind: z.literal('metric'),
  value: z.string().min(1).max(40),
  label: z.string().min(1).max(DISPLAY_TITLE_MAX_LENGTH),
  delta: z.string().min(1).max(40).optional(),
  tone: z.enum(DISPLAY_METRIC_TONES).optional(),
})

export const ChartSeriesSchema = z.object({
  name: z.string().min(1).max(60),
  points: z
    .array(z.object({ label: z.string().min(1).max(60), value: z.number().finite() }))
    .min(1)
    .max(DISPLAY_CHART_MAX_POINTS_PER_SERIES),
})

export const ChartWidgetContentSchema = z.object({
  kind: z.literal('chart'),
  type: z.enum(DISPLAY_CHART_TYPES),
  series: z.array(ChartSeriesSchema).min(1).max(DISPLAY_CHART_MAX_SERIES),
})

// Cross-field rules live on the UNION, not on a member: zod 3 refuses a
// refined (`ZodEffects`) member inside `discriminatedUnion`. Still one home —
// every caller validates through this schema.
export const DisplayWidgetContentSchema = z
  .discriminatedUnion('kind', [
    MarkdownWidgetContentSchema,
    TableWidgetContentSchema,
    MetricWidgetContentSchema,
    ChartWidgetContentSchema,
  ])
  .superRefine((content, ctx) => {
    if (content.kind !== 'table') return
    // A ragged row draws a broken table — catch it at the boundary rather than
    // letting the renderer paper over it with blanks.
    const ragged = content.rows.findIndex((row) => row.length !== content.columns.length)
    if (ragged !== -1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rows', ragged],
        message: `row ${ragged + 1} has ${content.rows[ragged]!.length} cells but the table has ${content.columns.length} columns`,
      })
    }
  })

export type MarkdownWidgetContent = z.infer<typeof MarkdownWidgetContentSchema>
export type TableWidgetContent = z.infer<typeof TableWidgetContentSchema>
export type MetricWidgetContent = z.infer<typeof MetricWidgetContentSchema>
export type ChartWidgetContent = z.infer<typeof ChartWidgetContentSchema>
export type DisplayWidgetContent = z.infer<typeof DisplayWidgetContentSchema>

/** Serialized size in bytes — the shape stored in the `content` json column and
 *  pushed over the live channel. `TextEncoder` (not `Buffer`) keeps contracts
 *  runnable in the browser as well as the server. */
export function measureDisplayWidgetContentBytes(content: DisplayWidgetContent): number {
  return new TextEncoder().encode(JSON.stringify(content)).length
}
