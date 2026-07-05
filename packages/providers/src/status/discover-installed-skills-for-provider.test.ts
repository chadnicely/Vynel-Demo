// Unit tests for `discoverInstalledSkillsForProvider` — asserts the
// workspacePath threading (present vs absent, per `exactOptionalPropertyTypes`)
// and the unregistered-id rejection. Fakes only; the real runtime's on-disk
// skills are never read.

import { describe, it, expect } from 'vitest'
import { ValidationError } from '@vynel/errors'
import type { DiscoverSkillsInput, InstalledSkill } from '../shared/installed-skill.js'
import { makeFakeAiAgentProvider } from '../test-support/fake-ai-agent-provider.js'
import { discoverInstalledSkillsForProvider } from './discover-installed-skills-for-provider.js'

const installedSkill: InstalledSkill = {
  providerId: 'claude',
  scope: 'user',
  skillName: 'email-drafter',
  displayDescription: 'Drafts emails in your voice',
  installLocation: '/fake/home/.claude/skills/email-drafter/SKILL.md',
  invocationSyntax: '/email-drafter',
}

function makeRecordingProvider(receivedInputs: DiscoverSkillsInput[]) {
  return makeFakeAiAgentProvider({
    discoverInstalledSkills: async (input) => {
      receivedInputs.push(input)
      return [installedSkill]
    },
  })
}

describe('discoverInstalledSkillsForProvider', () => {
  it('passes an empty input when workspacePath is omitted', async () => {
    const receivedInputs: DiscoverSkillsInput[] = []
    const active = makeRecordingProvider(receivedInputs)
    await expect(
      discoverInstalledSkillsForProvider({ providerId: 'claude' }, active),
    ).resolves.toEqual([installedSkill])
    expect(receivedInputs).toEqual([{}])
  })

  it('threads workspacePath through when present', async () => {
    const receivedInputs: DiscoverSkillsInput[] = []
    const active = makeRecordingProvider(receivedInputs)
    await discoverInstalledSkillsForProvider(
      { providerId: 'claude', workspacePath: '/tmp/acme' },
      active,
    )
    expect(receivedInputs).toEqual([{ workspacePath: '/tmp/acme' }])
  })

  it('throws ValidationError for an unregistered provider id', async () => {
    const active = makeFakeAiAgentProvider()
    await expect(
      discoverInstalledSkillsForProvider({ providerId: 'cursor' }, active),
    ).rejects.toThrow(ValidationError)
  })
})
