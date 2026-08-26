import { describe, expect, it } from 'vitest'
import { scheduleSourceLabel } from '../schedules/schedule-source-label.js'
import {
  BACKGROUND_TASK_REPORTER_LABEL,
  TASKS_REPORTER_LABEL,
  engineReporterKindOf,
  monitorSourceLabel,
} from './engine-reporter-labels.js'

describe('engineReporterKindOf', () => {
  it('reads each engine producer back off the label it composes', () => {
    expect(engineReporterKindOf(BACKGROUND_TASK_REPORTER_LABEL)).toBe('background-task')
    expect(engineReporterKindOf(TASKS_REPORTER_LABEL)).toBe('tasks')
    expect(engineReporterKindOf(scheduleSourceLabel('Tea'))).toBe('schedule')
    expect(engineReporterKindOf(monitorSourceLabel('pnpm test'))).toBe('monitor')
  })

  it('a real persona label is nobody the engine speaks for', () => {
    expect(engineReporterKindOf('Noah · vynel')).toBeNull()
    expect(engineReporterKindOf('Maintainer')).toBeNull()
    // A session that merely NAMES a producer is still a session.
    expect(engineReporterKindOf('Tasks helper')).toBeNull()
    expect(engineReporterKindOf(null)).toBeNull()
    expect(engineReporterKindOf(undefined)).toBeNull()
  })
})
