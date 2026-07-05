// Status op: the skills a provider's runtime sees installed on disk,
// optionally scoped to a workspace — the actual on-disk picture, distinct
// from what the Vynel `skills` domain thinks should be installed.

import { selectAiAgentProvider } from './select-ai-agent-provider.js'
import type { AiAgentProvider } from '../shared/ai-agent-provider.js'
import type { AiAgentProviderId } from '../shared/ai-agent-provider-id.js'
import type { InstalledSkill } from '../shared/installed-skill.js'

export type DiscoverInstalledSkillsForProviderInput = {
  providerId: AiAgentProviderId
  workspacePath?: string
}

export async function discoverInstalledSkillsForProvider(
  input: DiscoverInstalledSkillsForProviderInput,
  activeProvider?: AiAgentProvider,
): Promise<InstalledSkill[]> {
  const provider = selectAiAgentProvider(input.providerId, activeProvider)
  // Conditional spread — `exactOptionalPropertyTypes` rejects a literal
  // `workspacePath: undefined` against the optional `DiscoverSkillsInput` field.
  return provider.discoverInstalledSkills(
    input.workspacePath !== undefined ? { workspacePath: input.workspacePath } : {},
  )
}
