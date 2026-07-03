// The `email-drafter` Verified-skill bundle — Phase 1's worked
// example user-installable skill (D2). Demonstrates:
//   - `{{settings.<key>}}` template rendering with 2 settings
//     (defaultSignOff + tonePreference).
//   - The `string-enum` setting type (tonePreference).
//   - The empty `requiredMcpServers[]` code path (no MCP server
//     dependency — the agent already has approval-gated tool
//     access for sending).
//   - `recommendedScope: 'user'` — useful across every workspace.

import type { VerifiedSkillDefinition } from './verified-skill-definition.js'

export const emailDrafterSkill: VerifiedSkillDefinition = {
  skillId: 'email-drafter',
  displayName: 'Email Drafter',
  oneLineDescription: 'Helps the agent draft professional emails in your voice.',
  category: 'email',
  iconName: 'mail',
  version: '1.0.0',
  recommendedScope: 'user',
  isSystemInstalled: false,
  skillMarkdownTemplate: `# Email Drafter

You help the user draft emails.

When drafting:
- Default sign-off: {{settings.defaultSignOff}}
- Tone: {{settings.tonePreference}}
- Use the user's name from their USER.md when signing.

If the user asks to "send" rather than "draft", always surface an
approval card before invoking the email-send tool.
`,
  requiredMcpServers: [],
  settingsSchema: [
    {
      settingKey: 'defaultSignOff',
      displayLabel: 'Default sign-off',
      description: 'How emails are typically signed.',
      type: 'string',
      defaultValue: 'Best,',
      validationConstraints: { minLength: 1, maxLength: 200 },
    },
    {
      settingKey: 'tonePreference',
      displayLabel: 'Tone',
      description: 'The default tone for drafted emails.',
      type: 'string-enum',
      defaultValue: 'professional',
      enumValues: ['professional', 'casual', 'warm'] as const,
    },
  ],
}
