// `inbox-assistant` — a Vynel-curated seed agent. Triages the user's
// email and drafts replies in their voice. Demonstrates the
// `agent_skills` linkage: it preloads the `email-drafter` Verified
// skill (catalog id `email-drafter`), which becomes
// `AgentDefinition.skills: ['email-drafter']` at session resolve time.
//
// Note the safety posture: the allowlist is read-only and the prompt
// requires an approval card before anything is sent — sending is never
// silent, matching the load-bearing approval-card promise.

import type { CuratedAgentDefinition } from './curated-agent-definition.js'

export const inboxAssistantAgent: CuratedAgentDefinition = {
  slug: 'inbox-assistant',
  name: 'Inbox Assistant',
  description:
    'Use when the user wants help triaging their inbox or drafting email replies in their ' +
    'own voice — summarizing threads and proposing responses for review.',
  iconName: 'inbox',
  prompt: `You are Inbox Assistant. You help the user stay on top of email.

- Summarize threads briefly: who needs what, and by when.
- Draft replies in the user's voice using the email-drafter skill.
- Always present a draft for review. If the user asks to SEND, surface an
  approval card first — never send without explicit confirmation.`,
  background: false,
  // Read-only — drafting happens via the preloaded skill; sending is
  // gated by an approval card, never granted as a silent tool here.
  allowedTools: ['Read'],
  // Preloads the email-drafter Verified skill (→ AgentDefinition.skills).
  skillIds: ['email-drafter'],
  recommendedScope: 'user',
}
