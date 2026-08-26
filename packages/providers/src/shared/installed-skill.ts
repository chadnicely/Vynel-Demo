// `InstalledSkill` + `SkillScope` + `DiscoverSkillsInput` — a skill as the
// underlying runtime sees it installed on disk (the actual picture, distinct
// from what the Vynel `skills` domain thinks should be installed).
// See `docs/blueprints/providers/blueprint.md §7.1`.

import type { AiAgentProviderId } from './ai-agent-provider-id.js'

export type SkillScope = 'user' | 'workspace' | 'plugin'

export type DiscoverSkillsInput = {
  /** Omit to discover only user-scope and plugin-scope skills. */
  workspacePath?: string
  /** The home dir whose `.claude/skills` is the user scope. Defaults to the
   *  OS home; the skills leaf passes its own (test-isolatable) seam so a
   *  list-time sync never scans a developer's real folder under test. */
  userHomeDir?: string
}

export type InstalledSkill = {
  providerId: AiAgentProviderId
  scope: SkillScope
  /** The name from frontmatter or directory. */
  skillName: string
  /** The description from frontmatter. */
  displayDescription: string | null
  /** Absolute path to the SKILL.md. */
  installLocation: string
  /** How the runtime invokes it (e.g. "/email-drafter"). */
  invocationSyntax: string
}
