// The suggested-skills recommendation per workspace kind — editorial product
// voice ("for a small business, we recommend …"), a pure constant (no runtime
// computation). Phase 1's Verified catalog ships exactly ONE user-installable
// skill (`email-drafter`). The shape is multi-skill-ready: it grows additively
// as the catalog grows.

import type { WorkspaceKind } from '@vynel/contracts/workspaces/workspace-kind-bundles'

export interface SuggestedSkillsForWorkspaceKind {
  workspaceKind: WorkspaceKind
  defaultCheckedSkillIds: readonly string[]
  optionalSkillIds: readonly string[]
}

export const SUGGESTED_SKILLS_BY_WORKSPACE_KIND: readonly SuggestedSkillsForWorkspaceKind[] = [
  { workspaceKind: 'small-business', defaultCheckedSkillIds: ['email-drafter'], optionalSkillIds: [] },
  { workspaceKind: 'personal', defaultCheckedSkillIds: [], optionalSkillIds: ['email-drafter'] },
  { workspaceKind: 'project', defaultCheckedSkillIds: [], optionalSkillIds: ['email-drafter'] },
  { workspaceKind: 'custom', defaultCheckedSkillIds: ['email-drafter'], optionalSkillIds: [] },
]

export function resolveSuggestedSkills(workspaceKind: WorkspaceKind): {
  defaultCheckedSkillIds: readonly string[]
  optionalSkillIds: readonly string[]
} {
  const match = SUGGESTED_SKILLS_BY_WORKSPACE_KIND.find((s) => s.workspaceKind === workspaceKind)
  if (!match) return { defaultCheckedSkillIds: [], optionalSkillIds: [] }
  return {
    defaultCheckedSkillIds: match.defaultCheckedSkillIds,
    optionalSkillIds: match.optionalSkillIds,
  }
}
