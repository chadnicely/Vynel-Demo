// The Custom schedule template — user-defined prompt + cron. The default
// prompt is a placeholder that guides the user (D2).

import type { ScheduleTemplateDefinition } from './schedule-template-catalog.js'

export const customTemplate: ScheduleTemplateDefinition = {
  templateKind: 'custom',
  displayLabel: 'Custom',
  oneLineDescription: 'Your own recurring task — pick any schedule and write your own prompt.',
  iconName: 'sliders-horizontal',
  defaultCronExpression: '0 9 * * *',
  defaultDestinationKind: 'chat-only',
  defaultCatchUpOnMiss: false,
  defaultApprovalTimeoutMsOverride: null,
  promptTemplate: `Describe the recurring task you want me to run on this schedule. For example: "Summarize new support tickets and draft replies," or "Check the project board and list what is blocked." You can use {{user.displayName}}, {{workspace.name}}, and {{now.dateReadable}} in your prompt.`,
  recommendedFor: 'Anything the other templates do not cover.',
}
