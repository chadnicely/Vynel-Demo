// The Morning Briefing schedule template (daily 8am, chat-and-channel).

import type { ScheduleTemplateDefinition } from './schedule-template-catalog.js'

export const morningBriefingTemplate: ScheduleTemplateDefinition = {
  templateKind: 'morning-briefing',
  displayLabel: 'Morning briefing',
  oneLineDescription: 'A daily summary of what happened overnight and what is coming up today.',
  iconName: 'sunrise',
  defaultCronExpression: '0 8 * * *',
  defaultDestinationKind: 'chat-and-channel',
  defaultCatchUpOnMiss: false,
  defaultApprovalTimeoutMsOverride: null,
  promptTemplate: `Good morning, {{user.displayName}}. Give me a briefing on what happened in this {{workspace.kindReadable}} overnight and what is coming up today.

Cover:
- Any new emails I should know about
- My calendar for today
- Anything new or changed in my files since yesterday
- Any open items from yesterday I should follow up on

Keep it concise — under 200 words. End with a single suggested first action for the day.`,
  recommendedFor: 'Anyone who wants to start the day informed.',
}
