import { describe, it, expect } from 'vitest'
import {
  SUGGESTED_SKILLS_BY_WORKSPACE_KIND,
  resolveSuggestedSkills,
} from './suggested-skills.js'

describe('SUGGESTED_SKILLS_BY_WORKSPACE_KIND', () => {
  it('covers all four workspace kinds', () => {
    expect(SUGGESTED_SKILLS_BY_WORKSPACE_KIND.map((s) => s.workspaceKind).sort()).toEqual([
      'custom',
      'personal',
      'project',
      'small-business',
    ])
  })

  it('references only real Phase-1 skill ids (email-drafter), never workspace-context', () => {
    const allIds = SUGGESTED_SKILLS_BY_WORKSPACE_KIND.flatMap((s) => [
      ...s.defaultCheckedSkillIds,
      ...s.optionalSkillIds,
    ])
    expect(new Set(allIds)).toEqual(new Set(['email-drafter']))
    expect(allIds).not.toContain('workspace-context')
  })
})

describe('resolveSuggestedSkills', () => {
  it('default-checks email-drafter for small-business and custom', () => {
    expect(resolveSuggestedSkills('small-business').defaultCheckedSkillIds).toEqual(['email-drafter'])
    expect(resolveSuggestedSkills('custom').defaultCheckedSkillIds).toEqual(['email-drafter'])
  })

  it('offers email-drafter unchecked for personal and project', () => {
    expect(resolveSuggestedSkills('personal').defaultCheckedSkillIds).toEqual([])
    expect(resolveSuggestedSkills('personal').optionalSkillIds).toEqual(['email-drafter'])
    expect(resolveSuggestedSkills('project').optionalSkillIds).toEqual(['email-drafter'])
  })
})
