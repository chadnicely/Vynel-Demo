import { describe, expect, it } from 'vitest'
import {
  SCHEDULE_TEMPLATE_CATALOG,
  findScheduleTemplateByKind,
} from './schedule-template-catalog.js'

describe('schedule template catalog', () => {
  it('contains the templates in order (incl. the verbatim reminder)', () => {
    expect(SCHEDULE_TEMPLATE_CATALOG.map((template) => template.templateKind)).toEqual([
      'morning-briefing',
      'weekly-summary',
      'email-watch',
      'custom',
      'reminder',
    ])
  })

  it('only the reminder template delivers verbatim (no LLM turn)', () => {
    for (const template of SCHEDULE_TEMPLATE_CATALOG) {
      expect(template.deliversVerbatim ?? false).toBe(template.templateKind === 'reminder')
    }
  })

  it('findScheduleTemplateByKind returns the matching template', () => {
    expect(findScheduleTemplateByKind('email-watch')?.defaultCronExpression).toBe('0 9-17/2 * * 1-5')
    expect(findScheduleTemplateByKind('morning-briefing')?.defaultDestinationKind).toBe(
      'chat-and-channel',
    )
  })

  it('findScheduleTemplateByKind returns null for an unknown kind', () => {
    expect(findScheduleTemplateByKind('nope' as never)).toBeNull()
  })

  it('every template has a 5-field cron, the required fields, and catch-up off (D4)', () => {
    for (const template of SCHEDULE_TEMPLATE_CATALOG) {
      expect(template.defaultCronExpression.trim().split(/\s+/)).toHaveLength(5)
      expect(template.displayLabel.length).toBeGreaterThan(0)
      expect(template.oneLineDescription.length).toBeGreaterThan(0)
      expect(template.promptTemplate.length).toBeGreaterThan(0)
      expect(template.iconName.length).toBeGreaterThan(0)
      expect(template.defaultCatchUpOnMiss).toBe(false)
    }
  })
})
