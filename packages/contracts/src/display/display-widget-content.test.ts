import { describe, expect, it } from 'vitest'
import {
  DISPLAY_CHART_MAX_POINTS_PER_SERIES,
  DISPLAY_CHART_MAX_SERIES,
  DISPLAY_MAX_WIDGETS_PER_SCOPE,
  DISPLAY_TABLE_MAX_COLUMNS,
  DISPLAY_TABLE_MAX_ROWS,
  DISPLAY_TITLE_MAX_LENGTH,
  DISPLAY_WIDGET_CONTENT_MAX_BYTES,
  DisplayWidgetContentSchema,
  DisplayWidgetTitleSchema,
  measureDisplayWidgetContentBytes,
} from './display-widget-content.js'

function seriesOf(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    name: `series-${index}`,
    points: [{ label: 'mon', value: 1 }],
  }))
}

describe('display widget limits', () => {
  it('pins the three board limits the leaf, routes and UI all read', () => {
    expect(DISPLAY_WIDGET_CONTENT_MAX_BYTES).toBe(32_768)
    expect(DISPLAY_TITLE_MAX_LENGTH).toBe(80)
    expect(DISPLAY_MAX_WIDGETS_PER_SCOPE).toBe(12)
  })

  it('trims a title and rejects an empty or over-long one', () => {
    expect(DisplayWidgetTitleSchema.parse('  This week  ')).toBe('This week')
    expect(DisplayWidgetTitleSchema.safeParse('   ').success).toBe(false)
    expect(DisplayWidgetTitleSchema.safeParse('x'.repeat(DISPLAY_TITLE_MAX_LENGTH + 1)).success).toBe(
      false,
    )
  })
})

describe('DisplayWidgetContentSchema', () => {
  it('accepts each of the four kinds', () => {
    expect(DisplayWidgetContentSchema.safeParse({ kind: 'markdown', body: '# Hi' }).success).toBe(true)
    expect(
      DisplayWidgetContentSchema.safeParse({
        kind: 'table',
        columns: ['when', 'what'],
        rows: [['mon', 'digest']],
        caption: 'this week',
      }).success,
    ).toBe(true)
    expect(
      DisplayWidgetContentSchema.safeParse({ kind: 'metric', value: '12', label: 'runs', tone: 'live' })
        .success,
    ).toBe(true)
    expect(
      DisplayWidgetContentSchema.safeParse({ kind: 'chart', type: 'bar', series: seriesOf(1) }).success,
    ).toBe(true)
  })

  it('rejects an unknown kind — html is NOT shippable in P2', () => {
    expect(DisplayWidgetContentSchema.safeParse({ kind: 'html', body: '<b>hi</b>' }).success).toBe(false)
    expect(DisplayWidgetContentSchema.safeParse({ kind: 'iframe', src: 'x' }).success).toBe(false)
  })

  it('rejects an empty markdown body', () => {
    expect(DisplayWidgetContentSchema.safeParse({ kind: 'markdown', body: '' }).success).toBe(false)
  })

  it('enforces the table column, row and shape limits', () => {
    const columns = Array.from({ length: DISPLAY_TABLE_MAX_COLUMNS + 1 }, (_, i) => `c${i}`)
    expect(DisplayWidgetContentSchema.safeParse({ kind: 'table', columns, rows: [] }).success).toBe(false)

    const rows = Array.from({ length: DISPLAY_TABLE_MAX_ROWS + 1 }, () => ['a'])
    expect(DisplayWidgetContentSchema.safeParse({ kind: 'table', columns: ['a'], rows }).success).toBe(
      false,
    )

    const ragged = DisplayWidgetContentSchema.safeParse({
      kind: 'table',
      columns: ['when', 'what'],
      rows: [['mon']],
    })
    expect(ragged.success).toBe(false)
    expect(ragged.success === false && ragged.error.issues[0]!.message).toMatch(/1 cells but the table has 2/)
  })

  it('enforces the chart series and point limits', () => {
    expect(
      DisplayWidgetContentSchema.safeParse({
        kind: 'chart',
        type: 'line',
        series: seriesOf(DISPLAY_CHART_MAX_SERIES + 1),
      }).success,
    ).toBe(false)

    const points = Array.from({ length: DISPLAY_CHART_MAX_POINTS_PER_SERIES + 1 }, (_, i) => ({
      label: `p${i}`,
      value: i,
    }))
    expect(
      DisplayWidgetContentSchema.safeParse({
        kind: 'chart',
        type: 'donut',
        series: [{ name: 'a', points }],
      }).success,
    ).toBe(false)

    expect(
      DisplayWidgetContentSchema.safeParse({
        kind: 'chart',
        type: 'pie',
        series: seriesOf(1),
      }).success,
    ).toBe(false)
  })

  it('rejects a non-finite chart value (NaN would break the SVG scale)', () => {
    expect(
      DisplayWidgetContentSchema.safeParse({
        kind: 'chart',
        type: 'bar',
        series: [{ name: 'a', points: [{ label: 'x', value: Number.POSITIVE_INFINITY }] }],
      }).success,
    ).toBe(false)
  })

  it('measures serialized bytes, counting multi-byte characters as they weigh', () => {
    expect(measureDisplayWidgetContentBytes({ kind: 'markdown', body: 'hi' })).toBe(
      '{"kind":"markdown","body":"hi"}'.length,
    )
    const ascii = measureDisplayWidgetContentBytes({ kind: 'markdown', body: 'ee' })
    const accented = measureDisplayWidgetContentBytes({ kind: 'markdown', body: 'éé' })
    expect(accented).toBe(ascii + 2)
  })
})
