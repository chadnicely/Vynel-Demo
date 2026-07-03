// The Email Watch schedule template (every 2h, business hours, weekdays;
// chat-only).

import type { ScheduleTemplateDefinition } from './schedule-template-catalog.js'

export const emailWatchTemplate: ScheduleTemplateDefinition = {
  templateKind: 'email-watch',
  displayLabel: 'Email watch',
  oneLineDescription: 'Checks email every couple of hours during business hours and flags what needs attention.',
  iconName: 'mail',
  defaultCronExpression: '0 9-17/2 * * 1-5',
  defaultDestinationKind: 'chat-only',
  defaultCatchUpOnMiss: false,
  defaultApprovalTimeoutMsOverride: null,
  promptTemplate: `Check for new or important emails in this {{workspace.kindReadable}} since the last check.

For anything that needs my attention:
- Summarize who it is from and what they want
- Flag anything time-sensitive
- Suggest a draft reply where one is clearly warranted

If nothing needs attention, just say so in one line.`,
  recommendedFor: 'Anyone who wants a light touch on their inbox through the day.',
}
