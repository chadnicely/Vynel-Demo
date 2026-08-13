import { describe, it, expect } from 'vitest'
import type { DesktopActionRow } from '../repositories/desktop-actions.js'
import {
  buildDesktopContinuationPrompt,
  DESKTOP_CONTINUATION_WINDOW_MS,
} from './desktop-continuation-prompt.js'

const now = new Date('2026-08-13T12:00:00Z')

function makeRow(overrides: Partial<DesktopActionRow>): DesktopActionRow {
  return {
    id: 'a1',
    userId: 'u1',
    sessionId: 'primary-1',
    workspaceId: null,
    goal: 'send the weekly report',
    tool: 'act_on_app',
    appName: 'Outlook',
    detail: 'clicked Send',
    outcome: 'unverified',
    note: null,
    createdAt: new Date(now.getTime() - 60_000),
    ...overrides,
  }
}

describe('buildDesktopContinuationPrompt', () => {
  it('returns null when nothing was recorded', () => {
    expect(buildDesktopContinuationPrompt([], now)).toBeNull()
  })

  it('returns null when the last act is older than the window — history, not "last time"', () => {
    const stale = makeRow({
      createdAt: new Date(now.getTime() - DESKTOP_CONTINUATION_WINDOW_MS - 1),
    })
    expect(buildDesktopContinuationPrompt([stale], now)).toBeNull()
  })

  it('renders the last task oldest-first and instructs ASK-before-continuing', () => {
    // Rows arrive newest first (the repo's tail read); a person retraces a task
    // oldest first, so the section flips them.
    const rows = [
      makeRow({ id: 'a2', detail: 'clicked Send', createdAt: new Date(now.getTime() - 1_000) }),
      makeRow({
        id: 'a1',
        tool: 'launch_app',
        appName: 'Outlook',
        detail: 'launched (launched)',
        outcome: 'ok',
        createdAt: new Date(now.getTime() - 5_000),
      }),
    ]
    const section = buildDesktopContinuationPrompt(rows, now)
    expect(section).not.toBeNull()
    expect(section).toContain('Goal: send the weekly report')
    expect(section?.indexOf('launched (launched)')).toBeLessThan(section!.indexOf('clicked Send'))
    // The rule that makes NOT-auto-resume real: the model is told to ask.
    expect(section).toContain('ASK whether to carry on')
    expect(section).toContain('NEVER silently re-run the last act')
    // A failure note can quote on-screen (third-party) text; the section must
    // declare itself data, never instructions.
    expect(section).toContain('HISTORICAL RECORD')
  })

  it('marks the list as possibly truncated when it hits the act cap', () => {
    const rows = Array.from({ length: 20 }, (_, index) =>
      makeRow({ id: `a${index}`, detail: `step ${index}`, createdAt: new Date(now.getTime() - index * 1_000) }),
    )
    const section = buildDesktopContinuationPrompt(rows, now)
    expect(section).toContain('earlier acts may be omitted')
    // The tail survives the cap — the newest act is what "as far as X" means.
    expect(section).toContain('step 0')
  })

  it('shows only the NEWEST task — an older task with a different goal is cut', () => {
    const rows = [
      makeRow({ id: 'a3', goal: 'send the weekly report', detail: 'typed the summary' }),
      makeRow({
        id: 'a2',
        goal: 'clean up downloads',
        detail: 'deleted old-installer.exe',
        createdAt: new Date(now.getTime() - 120_000),
      }),
    ]
    const section = buildDesktopContinuationPrompt(rows, now)
    expect(section).toContain('typed the summary')
    expect(section).not.toContain('deleted old-installer.exe')
  })

  it('carries a failed act\'s note — the reason it stopped is the useful part', () => {
    const rows = [
      makeRow({ outcome: 'failed', note: 'field reads "" after typing', detail: 'type_text on subject' }),
    ]
    const section = buildDesktopContinuationPrompt(rows, now)
    expect(section).toContain('failed — field reads "" after typing')
  })
})
