// The Weekly Summary schedule template (Friday 5pm, chat-and-channel).

import type { ScheduleTemplateDefinition } from './schedule-template-catalog.js'

export const weeklySummaryTemplate: ScheduleTemplateDefinition = {
  templateKind: 'weekly-summary',
  displayLabel: 'Weekly summary',
  oneLineDescription: 'A Friday-afternoon recap of the week and what is open going into next week.',
  iconName: 'calendar-days',
  defaultCronExpression: '0 17 * * FRI',
  defaultDestinationKind: 'chat-and-channel',
  defaultCatchUpOnMiss: false,
  defaultApprovalTimeoutMsOverride: null,
  promptTemplate: `Good afternoon, {{user.displayName}}. It is {{now.dayOfWeek}} — give me a recap of this {{workspace.kindReadable}} for the week.

Cover:
- What got done this week
- Anything still open heading into next week
- Notable emails, decisions, or changes
- The one thing I should prioritize on Monday

Keep it concise — under 250 words.`,
  recommendedFor: 'Anyone who wants to close the week with a clear picture.',
}
